import "server-only";

import { buildSet, executor, type Queryable } from "./shared";
import type { ReservationContactUpdate, ReservationRow } from "./types";

// Repository for the shared `reservations` table (spec §4/§8).
//
// IMPORTANT: this module deliberately does NOT contain the capacity-checked,
// advisory-locked INSERT path. Creating a reservation/block MUST go through the
// race-safe engine (P2.1/P2.2) — advisory lock → buffered overlap recheck →
// insert, all in one transaction. Putting an unguarded INSERT here would invite
// a double-book. This repo provides READS, cancellations (status='cancelled',
// which frees capacity via the partial index), and non-capacity contact/notes
// edits only.
//
// TODO(P9): consolidate — mirrors the storefront's reservation row shape.

const RESERVATION_COLUMNS = `
  id, item_id, quantity, start_at, end_at, status, order_id,
  customer_email, customer_name, customer_phone, notes, group_id, series_id, created_at
`;

const CONTACT_UPDATE_COLUMNS = [
  "customer_email",
  "customer_name",
  "customer_phone",
  "notes",
] as const;

export async function getReservationById(
  id: string,
  client?: Queryable,
): Promise<ReservationRow | null> {
  const { rows } = await executor(client).query<ReservationRow>(
    `SELECT ${RESERVATION_COLUMNS} FROM reservations WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Reservations overlapping the half-open window [start, end) — the calendar
 * query. Overlap predicate matches spec §8: NOT (end_at <= start OR start_at >= end).
 * Cancelled rows are excluded unless `includeCancelled` is set (the weekly view
 * greys/omits them).
 */
export async function listReservationsInRange(
  start: Date,
  end: Date,
  opts: { includeCancelled?: boolean } = {},
  client?: Queryable,
): Promise<ReservationRow[]> {
  const statusFilter = opts.includeCancelled ? "" : "AND status <> 'cancelled'";
  const { rows } = await executor(client).query<ReservationRow>(
    `SELECT ${RESERVATION_COLUMNS} FROM reservations
      WHERE NOT (end_at <= $1 OR start_at >= $2) ${statusFilter}
      ORDER BY start_at ASC`,
    [start, end],
  );
  return rows;
}

export async function listReservationsByGroup(
  groupId: string,
  client?: Queryable,
): Promise<ReservationRow[]> {
  const { rows } = await executor(client).query<ReservationRow>(
    `SELECT ${RESERVATION_COLUMNS} FROM reservations WHERE group_id = $1
     ORDER BY start_at ASC`,
    [groupId],
  );
  return rows;
}

export async function listReservationsBySeries(
  seriesId: string,
  client?: Queryable,
): Promise<ReservationRow[]> {
  const { rows } = await executor(client).query<ReservationRow>(
    `SELECT ${RESERVATION_COLUMNS} FROM reservations WHERE series_id = $1
     ORDER BY start_at ASC`,
    [seriesId],
  );
  return rows;
}

export async function listReservationsForItem(
  itemId: string,
  opts: { includeCancelled?: boolean } = {},
  client?: Queryable,
): Promise<ReservationRow[]> {
  const statusFilter = opts.includeCancelled ? "" : "WHERE status <> 'cancelled'";
  const scope = statusFilter
    ? `${statusFilter} AND item_id = $1`
    : "WHERE item_id = $1";
  const { rows } = await executor(client).query<ReservationRow>(
    `SELECT ${RESERVATION_COLUMNS} FROM reservations ${scope} ORDER BY start_at ASC`,
    [itemId],
  );
  return rows;
}

/** Update contact/notes only. Dates/quantity edits go through the engine (P2). */
export async function updateReservationContact(
  id: string,
  patch: ReservationContactUpdate,
  client?: Queryable,
): Promise<ReservationRow | null> {
  const { clause, values, nextIndex } = buildSet(
    patch as Record<string, unknown>,
    CONTACT_UPDATE_COLUMNS,
  );
  if (!clause) return getReservationById(id, client);
  const { rows } = await executor(client).query<ReservationRow>(
    `UPDATE reservations SET ${clause} WHERE id = $${nextIndex}
     RETURNING ${RESERVATION_COLUMNS}`,
    [...values, id],
  );
  return rows[0] ?? null;
}

/** Cancel one reservation (frees capacity via the partial index). */
export async function cancelReservation(
  id: string,
  client?: Queryable,
): Promise<ReservationRow | null> {
  const { rows } = await executor(client).query<ReservationRow>(
    `UPDATE reservations SET status = 'cancelled' WHERE id = $1
     RETURNING ${RESERVATION_COLUMNS}`,
    [id],
  );
  return rows[0] ?? null;
}

/** Cancel every reservation in a group (delete-this-instance). Returns count. */
export async function cancelReservationsByGroup(
  groupId: string,
  client?: Queryable,
): Promise<number> {
  const { rowCount } = await executor(client).query(
    `UPDATE reservations SET status = 'cancelled'
      WHERE group_id = $1 AND status <> 'cancelled'`,
    [groupId],
  );
  return rowCount ?? 0;
}

/**
 * Cancel reservations in a series (delete-the-whole-series). By default only
 * future rows are cancelled (past occurrences are kept as history, spec §9);
 * pass `fromInstant` to control the cutoff, or `includePast` to cancel all.
 */
export async function cancelReservationsBySeries(
  seriesId: string,
  opts: { fromInstant?: Date; includePast?: boolean } = {},
  client?: Queryable,
): Promise<number> {
  if (opts.includePast) {
    const { rowCount } = await executor(client).query(
      `UPDATE reservations SET status = 'cancelled'
        WHERE series_id = $1 AND status <> 'cancelled'`,
      [seriesId],
    );
    return rowCount ?? 0;
  }
  const cutoff = opts.fromInstant ?? new Date();
  const { rowCount } = await executor(client).query(
    `UPDATE reservations SET status = 'cancelled'
      WHERE series_id = $1 AND status <> 'cancelled' AND start_at >= $2`,
    [seriesId, cutoff],
  );
  return rowCount ?? 0;
}
