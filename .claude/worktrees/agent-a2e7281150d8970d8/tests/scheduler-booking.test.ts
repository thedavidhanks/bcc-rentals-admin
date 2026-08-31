import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Postgres seam. A single transaction client (txQuery) drives the whole
// booking; we route responses by SQL text so tests read like the real flow.
const txQuery = vi.fn();

vi.mock("@/lib/db", () => ({
  getPool: () => ({ query: vi.fn() }),
  withTransaction: (fn: (client: { query: typeof txQuery }) => Promise<unknown>) =>
    fn({ query: txQuery }),
}));

import { scheduler } from "@/lib/scheduler/client";
import { GroupBookingConflictError, SchedulerError } from "@/lib/scheduler/errors";

const rows = <T>(...r: T[]) => ({ rows: r });

// Item fixtures keyed by slug. `reserved` is the DB SUM returned for that item.
type ItemFixture = { id: string; total_stock: number; buffer_minutes: number; reserved: number };

function installDb(items: Record<string, ItemFixture>) {
  let groupSeq = 0;
  let resvSeq = 0;
  txQuery.mockReset();
  txQuery.mockImplementation(async (sql: string, params: unknown[]) => {
    const s = String(sql);
    if (s.includes("pg_advisory_xact_lock")) return rows();
    if (s.includes("FROM items")) {
      const requested = (params[0] as string[]) ?? [];
      const out = requested
        .filter((slug) => items[slug])
        .map((slug) => ({
          id: items[slug].id,
          slug,
          total_stock: items[slug].total_stock,
          buffer_minutes: items[slug].buffer_minutes,
        }));
      return { rows: out };
    }
    if (s.includes("SUM(quantity)")) {
      const itemId = params[0] as string;
      const fixture = Object.values(items).find((i) => i.id === itemId);
      return rows({ reserved: fixture?.reserved ?? 0 });
    }
    if (s.includes("INSERT INTO reservation_groups")) {
      return rows({ id: `group-${groupSeq++}` });
    }
    if (s.includes("INSERT INTO reservations")) {
      return rows({
        id: `resv-${resvSeq++}`,
        item_id: params[0],
        quantity: params[1],
        start_at: new Date(params[2] as string),
        end_at: new Date(params[3] as string),
        status: params[4],
        order_id: params[5],
        customer_email: params[6],
        customer_name: params[7],
        customer_phone: params[8],
        notes: params[9],
        group_id: params[10],
        series_id: params[11],
        created_at: new Date("2026-07-10T00:00:00.000Z"),
      });
    }
    return rows();
  });
}

const lockCalls = () =>
  txQuery.mock.calls
    .filter((c) => String(c[0]).includes("pg_advisory_xact_lock"))
    .map((c) => (c[1] as string[])[0]);

const sqlList = () => txQuery.mock.calls.map((c) => String(c[0]));

const AUG1 = { start: "2026-08-01T14:00:00.000Z", end: "2026-08-01T16:00:00.000Z" };
const AUG2 = { start: "2026-08-02T14:00:00.000Z", end: "2026-08-02T16:00:00.000Z" };

beforeEach(() => {
  txQuery.mockReset();
});

describe("scheduler.createBooking (P2.2 multi-item / multi-occurrence)", () => {
  it("acquires per-item advisory locks in stable (ascending) slug order", async () => {
    installDb({
      tent: { id: "item-tent", total_stock: 1, buffer_minutes: 0, reserved: 0 },
      chairs: { id: "item-chairs", total_stock: 100, buffer_minutes: 0, reserved: 0 },
    });

    // Input lists tent before chairs; locks must still be chairs, then tent.
    await scheduler.createBooking({
      groups: [
        {
          title: "Sunday service",
          lines: [
            { itemSlug: "tent", startISO: AUG1.start, endISO: AUG1.end },
            { itemSlug: "chairs", quantity: 50, startISO: AUG1.start, endISO: AUG1.end },
          ],
        },
      ],
    });

    expect(lockCalls()).toEqual(["chairs", "tent"]);
  });

  it("commits all rows under one group when every window has capacity", async () => {
    installDb({
      tent: { id: "item-tent", total_stock: 1, buffer_minutes: 0, reserved: 0 },
      chairs: { id: "item-chairs", total_stock: 100, buffer_minutes: 0, reserved: 0 },
    });

    const result = await scheduler.createBooking({
      groups: [
        {
          lines: [
            { itemSlug: "tent", startISO: AUG1.start, endISO: AUG1.end },
            { itemSlug: "chairs", quantity: 50, startISO: AUG1.start, endISO: AUG1.end },
          ],
        },
      ],
    });

    expect(result.reservationCount).toBe(2);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].reservations.map((r) => r.itemSlug).sort()).toEqual([
      "chairs",
      "tent",
    ]);
  });

  it("rolls back everything (no inserts) and reports the failing item when one is full", async () => {
    installDb({
      tent: { id: "item-tent", total_stock: 1, buffer_minutes: 0, reserved: 1 }, // full
      chairs: { id: "item-chairs", total_stock: 100, buffer_minutes: 0, reserved: 0 },
    });

    const err = await scheduler
      .createBooking({
        groups: [
          {
            lines: [
              { itemSlug: "tent", startISO: AUG1.start, endISO: AUG1.end },
              { itemSlug: "chairs", quantity: 50, startISO: AUG1.start, endISO: AUG1.end },
            ],
          },
        ],
      })
      .catch((e) => e);

    expect(err).toBeInstanceOf(GroupBookingConflictError);
    expect(err.failures).toHaveLength(1);
    expect(err.failures[0]).toMatchObject({ itemSlug: "tent", requested: 1, available: 0 });

    // All-or-nothing: nothing was inserted before the throw.
    const sql = sqlList();
    expect(sql.some((s) => s.includes("INSERT INTO reservation_groups"))).toBe(false);
    expect(sql.some((s) => s.includes("INSERT INTO reservations"))).toBe(false);
  });

  it("reports EVERY failing (item x occurrence), not just the first", async () => {
    installDb({
      tent: { id: "item-tent", total_stock: 1, buffer_minutes: 0, reserved: 1 },
      stage: { id: "item-stage", total_stock: 1, buffer_minutes: 0, reserved: 1 },
    });

    const err = await scheduler
      .createBooking({
        groups: [
          {
            occurrenceKey: "2026-08-01",
            lines: [
              { itemSlug: "tent", startISO: AUG1.start, endISO: AUG1.end },
              { itemSlug: "stage", startISO: AUG1.start, endISO: AUG1.end },
            ],
          },
        ],
      })
      .catch((e) => e);

    expect(err).toBeInstanceOf(GroupBookingConflictError);
    expect(err.failures).toHaveLength(2);
    expect(err.failures.map((f: { itemSlug: string }) => f.itemSlug).sort()).toEqual([
      "stage",
      "tent",
    ]);
    expect(err.failures.every((f: { occurrenceKey: string }) => f.occurrenceKey === "2026-08-01")).toBe(
      true,
    );
  });

  it("counts overlapping sibling lines for the same item within one booking", async () => {
    // 100 chairs, but two overlapping lines of 60 each = 120 > 100.
    installDb({
      chairs: { id: "item-chairs", total_stock: 100, buffer_minutes: 0, reserved: 0 },
    });

    const err = await scheduler
      .createBooking({
        groups: [
          {
            lines: [
              { itemSlug: "chairs", quantity: 60, startISO: AUG1.start, endISO: AUG1.end },
              { itemSlug: "chairs", quantity: 60, startISO: AUG1.start, endISO: AUG1.end },
            ],
          },
        ],
      })
      .catch((e) => e);

    expect(err).toBeInstanceOf(GroupBookingConflictError);
    expect(err.failures).toHaveLength(2); // each line sees the other's 60
    expect(sqlList().some((s) => s.includes("INSERT INTO reservations"))).toBe(false);
  });

  it("allows the same unique item across non-overlapping occurrences (multi-occurrence)", async () => {
    installDb({
      tent: { id: "item-tent", total_stock: 1, buffer_minutes: 0, reserved: 0 },
    });

    const result = await scheduler.createBooking({
      seriesId: "44444444-4444-4444-8444-444444444444",
      createdBy: "uid-scheduler",
      groups: [
        { occurrenceKey: "2026-08-01", occurrenceAt: AUG1.start, lines: [{ itemSlug: "tent", startISO: AUG1.start, endISO: AUG1.end }] },
        { occurrenceKey: "2026-08-02", occurrenceAt: AUG2.start, lines: [{ itemSlug: "tent", startISO: AUG2.start, endISO: AUG2.end }] },
      ],
    });

    expect(result.groups).toHaveLength(2);
    expect(result.reservationCount).toBe(2);
    expect(result.groups.map((g) => g.occurrenceKey)).toEqual(["2026-08-01", "2026-08-02"]);
    // series_id threaded onto every reservation row.
    const insertResvParams = txQuery.mock.calls
      .filter((c) => String(c[0]).includes("INSERT INTO reservations"))
      .map((c) => (c[1] as unknown[])[11]);
    expect(insertResvParams).toEqual([
      "44444444-4444-4444-8444-444444444444",
      "44444444-4444-4444-8444-444444444444",
    ]);
    // created_by threaded onto every group row.
    const groupCreatedBy = txQuery.mock.calls
      .filter((c) => String(c[0]).includes("INSERT INTO reservation_groups"))
      .map((c) => (c[1] as unknown[])[7]);
    expect(groupCreatedBy).toEqual(["uid-scheduler", "uid-scheduler"]);
  });

  it("throws SchedulerError listing unknown item slugs", async () => {
    installDb({
      tent: { id: "item-tent", total_stock: 1, buffer_minutes: 0, reserved: 0 },
    });

    const err = await scheduler
      .createBooking({
        groups: [
          {
            lines: [
              { itemSlug: "tent", startISO: AUG1.start, endISO: AUG1.end },
              { itemSlug: "ghost", startISO: AUG1.start, endISO: AUG1.end },
            ],
          },
        ],
      })
      .catch((e) => e);

    expect(err).toBeInstanceOf(SchedulerError);
    expect(err).not.toBeInstanceOf(GroupBookingConflictError);
    expect(String(err.message)).toContain("ghost");
    // Locks are taken for every distinct slug (sorted) before the lookup.
    expect(lockCalls()).toEqual(["ghost", "tent"]);
  });

  it("widens each line's window by the item's buffer_minutes when checking capacity", async () => {
    installDb({
      tent: { id: "item-tent", total_stock: 1, buffer_minutes: 15, reserved: 0 },
    });

    await scheduler.createBooking({
      groups: [{ lines: [{ itemSlug: "tent", startISO: AUG1.start, endISO: AUG1.end }] }],
    });

    const capParams = txQuery.mock.calls.find((c) => String(c[0]).includes("SUM(quantity)"))![1];
    expect(capParams).toEqual([
      "item-tent",
      "2026-08-01T13:45:00.000Z",
      "2026-08-01T16:15:00.000Z",
    ]);
  });
});
