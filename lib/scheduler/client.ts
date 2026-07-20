import "server-only";
import type { PoolClient } from "pg";
import { getPool, withTransaction } from "@/lib/db";
import {
  GroupBookingConflictError,
  SchedulerConflictError,
  SchedulerError,
  type BookingFailure,
} from "./errors";
import {
  createBookingInputSchema,
  createReservationInputSchema,
  getAvailabilityInputSchema,
  type Availability,
  type BookingResult,
  type CreateBookingInput,
  type CreateReservationInput,
  type GetAvailabilityInput,
  type Reservation,
  type ReservationStatus,
} from "./types";

// TODO(P9): consolidate — the single-item race-safe write is copied from the
// storefront's lib/scheduler/client.ts (createReservation). The multi-item /
// multi-occurrence path (createBooking) extends the same lock → recheck → insert
// pattern per spec §8. Both must stay byte-for-byte equivalent to the storefront's
// capacity semantics so a staff block and a customer booking can never both claim
// the last unit.

// Overlap predicate (half-open intervals): a stored reservation overlaps the
// requested [start, end) window unless it ends at/before start or starts at/after
// end. `status <> 'cancelled'` matches the partial index reservations_item_time_idx.
const OVERLAP = "status <> 'cancelled' AND NOT (end_at <= $2 OR start_at >= $3)";

const INSERT_COLUMNS =
  "item_id, quantity, start_at, end_at, status, order_id, customer_email, customer_name, customer_phone, notes, group_id, series_id";

type ItemRow = { id: string; slug: string; total_stock: number; buffer_minutes: number };

type ReservationRow = {
  id: string;
  item_id: string;
  quantity: number;
  start_at: Date;
  end_at: Date;
  status: ReservationStatus;
  order_id: string | null;
  customer_email: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  notes: string | null;
  group_id: string | null;
  series_id: string | null;
  created_at: Date;
};

const toISO = (v: Date | string): string =>
  v instanceof Date ? v.toISOString() : new Date(v).toISOString();

// Shifts an ISO timestamp by `minutes` (may be negative). Used to widen the overlap
// window by an item's buffer so bookings can't butt up against each other.
const shiftISO = (iso: string, minutes: number): string =>
  new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();

/**
 * Half-open overlap test between a widened query window [bufStart, bufEnd) and a
 * raw stored/prospective window [rawStart, rawEnd). Mirrors the SQL OVERLAP
 * predicate exactly so JS-side sibling accounting matches the DB check.
 */
function windowsOverlap(
  bufStartISO: string,
  bufEndISO: string,
  rawStartISO: string,
  rawEndISO: string,
): boolean {
  const bs = new Date(bufStartISO).getTime();
  const be = new Date(bufEndISO).getTime();
  const rs = new Date(rawStartISO).getTime();
  const re = new Date(rawEndISO).getTime();
  return !(re <= bs || rs >= be);
}

function mapReservation(row: ReservationRow, itemSlug: string): Reservation {
  return {
    id: row.id,
    itemId: row.item_id,
    itemSlug,
    quantity: row.quantity,
    startISO: toISO(row.start_at),
    endISO: toISO(row.end_at),
    status: row.status,
    orderId: row.order_id,
    customer: {
      email: row.customer_email,
      name: row.customer_name,
      phone: row.customer_phone,
    },
    notes: row.notes,
    groupId: row.group_id,
    seriesId: row.series_id,
    createdAt: toISO(row.created_at),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- shared low-level DB helpers (used by both single and multi paths) ----

/** Serialize all writers for `itemSlug` until commit/rollback. */
async function lockItem(client: PoolClient, itemSlug: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1), 0)", [itemSlug]);
}

/**
 * Sum of non-cancelled reserved quantity for `itemId` over [startISO, endISO)
 * widened by `bufferMinutes` on each side. Mirrors the storefront capacity query.
 */
async function reservedInWindow(
  client: PoolClient,
  itemId: string,
  startISO: string,
  endISO: string,
  bufferMinutes: number,
): Promise<number> {
  const res = await client.query<{ reserved: number }>(
    `SELECT COALESCE(SUM(quantity), 0)::int AS reserved FROM reservations WHERE item_id = $1 AND ${OVERLAP}`,
    [itemId, shiftISO(startISO, -bufferMinutes), shiftISO(endISO, bufferMinutes)],
  );
  return res.rows[0].reserved;
}

async function insertReservationRow(
  client: PoolClient,
  values: {
    itemId: string;
    quantity: number;
    startISO: string;
    endISO: string;
    status: ReservationStatus;
    orderId?: string | null;
    customer?: { email?: string; name?: string; phone?: string };
    notes?: string | null;
    groupId?: string | null;
    seriesId?: string | null;
  },
): Promise<ReservationRow> {
  const res = await client.query<ReservationRow>(
    `INSERT INTO reservations (${INSERT_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      values.itemId,
      values.quantity,
      values.startISO,
      values.endISO,
      values.status,
      values.orderId ?? null,
      values.customer?.email ?? null,
      values.customer?.name ?? null,
      values.customer?.phone ?? null,
      values.notes ?? null,
      values.groupId ?? null,
      values.seriesId ?? null,
    ],
  );
  return res.rows[0];
}

export const scheduler = {
  /**
   * Availability for `itemSlug` over [startISO, endISO). Returns the overlapping
   * non-cancelled reservations plus aggregate capacity. The window is widened by
   * the item's `buffer_minutes` (or the `bufferMinutes` override) before comparing.
   */
  async getAvailability(input: GetAvailabilityInput): Promise<Availability> {
    const { itemSlug, startISO, endISO, quantity, bufferMinutes } =
      getAvailabilityInputSchema.parse(input);
    const pool = getPool();

    const itemRes = await pool.query<ItemRow>(
      "SELECT id, slug, total_stock, buffer_minutes FROM items WHERE slug = $1",
      [itemSlug],
    );
    const item = itemRes.rows[0];
    if (!item) throw new SchedulerError(`Unknown item: ${itemSlug}`);

    const buffer = bufferMinutes ?? item.buffer_minutes ?? 0;
    const resvRes = await pool.query<ReservationRow>(
      `SELECT * FROM reservations WHERE item_id = $1 AND ${OVERLAP} ORDER BY start_at`,
      [item.id, shiftISO(startISO, -buffer), shiftISO(endISO, buffer)],
    );
    const reservations = resvRes.rows.map((r) => mapReservation(r, itemSlug));
    const reserved = reservations.reduce((sum, r) => sum + r.quantity, 0);
    const available = item.total_stock - reserved;

    return {
      itemSlug,
      itemId: item.id,
      totalStock: item.total_stock,
      requested: quantity,
      reserved,
      available,
      isAvailable: available >= quantity,
      reservations,
    };
  },

  /**
   * P2.1 — Race-safe SINGLE-item write. Takes a per-item advisory lock, re-checks
   * buffered-window capacity, then inserts the reservation (default status
   * 'block'), all inside one transaction. Throws SchedulerConflictError when
   * capacity is exhausted. The window is widened by the item's buffer_minutes
   * (or the bufferMinutes override).
   */
  async createReservation(input: CreateReservationInput): Promise<Reservation> {
    const data = createReservationInputSchema.parse(input);

    return withTransaction(async (client) => {
      // 1. Serialize all writers for this item until commit/rollback.
      await lockItem(client, data.itemSlug);

      // 2. Look up the item (id, stock, buffer) under the lock.
      const itemRes = await client.query<ItemRow>(
        "SELECT id, slug, total_stock, buffer_minutes FROM items WHERE slug = $1",
        [data.itemSlug],
      );
      const item = itemRes.rows[0];
      if (!item) throw new SchedulerError(`Unknown item: ${data.itemSlug}`);

      // 3. Re-check capacity over the buffered window.
      const buffer = data.bufferMinutes ?? item.buffer_minutes ?? 0;
      const reserved = await reservedInWindow(
        client,
        item.id,
        data.startISO,
        data.endISO,
        buffer,
      );
      if (reserved + data.quantity > item.total_stock) {
        throw new SchedulerConflictError(
          `No capacity for ${data.itemSlug}: requested ${data.quantity}, ${
            item.total_stock - reserved
          } available`,
          {
            itemSlug: data.itemSlug,
            requested: data.quantity,
            available: item.total_stock - reserved,
          },
        );
      }

      // 4. Insert. COMMIT (and lock release) happen in withTransaction.
      const row = await insertReservationRow(client, {
        itemId: item.id,
        quantity: data.quantity,
        startISO: data.startISO,
        endISO: data.endISO,
        status: data.status,
        customer: data.customer,
        notes: data.notes,
        groupId: data.groupId,
        seriesId: data.seriesId,
      });
      return mapReservation(row, data.itemSlug);
    });
  },

  /**
   * P2.2 — Race-safe MULTI-item / MULTI-occurrence booking. One transaction,
   * all-or-nothing:
   *   1. Acquire the per-item advisory lock for every DISTINCT item, in stable
   *      slug order (ascending), to avoid deadlocks between concurrent bookings.
   *   2. Re-check buffered-window capacity for EVERY (item × occurrence) window,
   *      accounting for other lines in the same booking that overlap the same
   *      item. Collect ALL failures — never partially commit.
   *   3. Only if every window has capacity, insert one reservation_groups row per
   *      occurrence and its reservations rows. Any failure throws
   *      GroupBookingConflictError and the transaction rolls back (nothing commits).
   */
  async createBooking(input: CreateBookingInput): Promise<BookingResult> {
    const data = createBookingInputSchema.parse(input);

    // Flatten every line across every group, tagged with its group for reporting.
    const flat = data.groups.flatMap((group, groupIndex) => {
      const occurrenceKey =
        group.occurrenceKey ?? group.occurrenceAt ?? null;
      return group.lines.map((line, lineIndex) => ({
        groupIndex,
        lineIndex,
        occurrenceKey,
        itemSlug: line.itemSlug,
        quantity: line.quantity ?? 1,
        startISO: line.startISO,
        endISO: line.endISO,
        bufferOverride: line.bufferMinutes,
        notes: line.notes,
        customer: line.customer,
      }));
    });

    return withTransaction(async (client) => {
      // 1. Lock every distinct item in stable (ascending) slug order.
      const distinctSlugs = [...new Set(flat.map((l) => l.itemSlug))].sort();
      for (const slug of distinctSlugs) {
        await lockItem(client, slug);
      }

      // 2. Load all items under the locks; reject if any slug is unknown.
      const itemsRes = await client.query<ItemRow>(
        "SELECT id, slug, total_stock, buffer_minutes FROM items WHERE slug = ANY($1)",
        [distinctSlugs],
      );
      const itemBySlug = new Map(itemsRes.rows.map((r) => [r.slug, r]));
      const missing = distinctSlugs.filter((s) => !itemBySlug.has(s));
      if (missing.length > 0) {
        throw new SchedulerError(`Unknown item(s): ${missing.join(", ")}`, { missing });
      }

      // Resolve effective buffer per line (override, else item's buffer_minutes).
      const lines = flat.map((l) => {
        const item = itemBySlug.get(l.itemSlug)!;
        return { ...l, item, buffer: l.bufferOverride ?? item.buffer_minutes ?? 0 };
      });

      // 3. Capacity check for EVERY window. Collect all failures (all-or-nothing).
      const failures: BookingFailure[] = [];
      for (const line of lines) {
        const dbReserved = await reservedInWindow(
          client,
          line.item.id,
          line.startISO,
          line.endISO,
          line.buffer,
        );

        // Other lines in THIS booking for the same item whose raw window overlaps
        // this line's buffered window also consume capacity (they aren't yet in the
        // DB). Mirror the SQL predicate: buffered query window vs sibling raw window.
        const bufStart = shiftISO(line.startISO, -line.buffer);
        const bufEnd = shiftISO(line.endISO, line.buffer);
        let siblingReserved = 0;
        for (const other of lines) {
          if (other === line) continue;
          if (other.item.id !== line.item.id) continue;
          if (windowsOverlap(bufStart, bufEnd, other.startISO, other.endISO)) {
            siblingReserved += other.quantity;
          }
        }

        const reserved = dbReserved + siblingReserved;
        if (reserved + line.quantity > line.item.total_stock) {
          failures.push({
            itemSlug: line.itemSlug,
            occurrenceKey: line.occurrenceKey,
            startISO: line.startISO,
            endISO: line.endISO,
            requested: line.quantity,
            available: line.item.total_stock - reserved,
          });
        }
      }

      if (failures.length > 0) {
        // Throwing rolls back the transaction — nothing is inserted.
        throw new GroupBookingConflictError(failures);
      }

      // 4. Insert: one reservation_groups row per occurrence, then its lines.
      const groups: BookingResult["groups"] = [];
      for (let gi = 0; gi < data.groups.length; gi++) {
        const group = data.groups[gi];
        const groupRes = await client.query<{ id: string }>(
          `INSERT INTO reservation_groups
             (title, contact_name, contact_email, contact_phone, notes, series_id, occurrence_at, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            group.title ?? null,
            group.contactName ?? null,
            group.contactEmail ?? null,
            group.contactPhone ?? null,
            group.notes ?? null,
            data.seriesId ?? null,
            group.occurrenceAt ?? null,
            data.createdBy ?? null,
          ],
        );
        const groupId = groupRes.rows[0].id;

        const reservations: Reservation[] = [];
        for (const line of lines.filter((l) => l.groupIndex === gi)) {
          const row = await insertReservationRow(client, {
            itemId: line.item.id,
            quantity: line.quantity,
            startISO: line.startISO,
            endISO: line.endISO,
            status: "block",
            customer: line.customer,
            notes: line.notes,
            groupId,
            seriesId: data.seriesId,
          });
          reservations.push(mapReservation(row, line.itemSlug));
        }

        groups.push({
          id: groupId,
          occurrenceKey: group.occurrenceKey ?? group.occurrenceAt ?? null,
          reservations,
        });
      }

      return {
        groups,
        reservationCount: groups.reduce((n, g) => n + g.reservations.length, 0),
      };
    });
  },

  /** Fetches a reservation by id, or null if not found (or id isn't a uuid). */
  async getReservation(id: string): Promise<Reservation | null> {
    if (!UUID_RE.test(id)) return null;
    const res = await getPool().query<ReservationRow & { item_slug: string }>(
      `SELECT r.*, i.slug AS item_slug
         FROM reservations r JOIN items i ON i.id = r.item_id
        WHERE r.id = $1`,
      [id],
    );
    const row = res.rows[0];
    return row ? mapReservation(row, row.item_slug) : null;
  },

  /**
   * Cancels a reservation (sets status = 'cancelled'), freeing its capacity.
   * Idempotent; returns the updated reservation, or null if the id is unknown.
   */
  async cancelReservation(id: string): Promise<Reservation | null> {
    if (!UUID_RE.test(id)) return null;
    const res = await getPool().query<ReservationRow & { item_slug: string }>(
      `UPDATE reservations r SET status = 'cancelled'
         FROM items i
        WHERE r.id = $1 AND i.id = r.item_id
        RETURNING r.*, i.slug AS item_slug`,
      [id],
    );
    const row = res.rows[0];
    return row ? mapReservation(row, row.item_slug) : null;
  },
};
