import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Postgres seam (lib/db) so no real pg Pool or env boot validation runs.
// `getPool().query` and the transaction client's `query` are separate vi.fns so
// tests can enqueue per-call results and assert query order/params.
const poolQuery = vi.fn();
const txQuery = vi.fn();

vi.mock("@/lib/db", () => ({
  getPool: () => ({ query: poolQuery }),
  // Pass-through: invoke fn with a mock client, rethrow on error like the real impl.
  withTransaction: (fn: (client: { query: typeof txQuery }) => Promise<unknown>) =>
    fn({ query: txQuery }),
}));

import { scheduler } from "@/lib/scheduler/client";
import { SchedulerConflictError, SchedulerError } from "@/lib/scheduler/errors";
import type { ReservationStatus } from "@/lib/scheduler/types";

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
  item_slug?: string;
};

const START = "2026-08-01T14:00:00.000Z";
const END = "2026-08-01T16:00:00.000Z";
const UUID = "11111111-1111-4111-8111-111111111111";

function makeRow(overrides: Partial<ReservationRow> = {}): ReservationRow {
  return {
    id: UUID,
    item_id: "item-1",
    quantity: 1,
    start_at: new Date(START),
    end_at: new Date(END),
    status: "block",
    order_id: null,
    customer_email: null,
    customer_name: null,
    customer_phone: null,
    notes: null,
    group_id: null,
    series_id: null,
    created_at: new Date("2026-07-10T00:00:00.000Z"),
    ...overrides,
  };
}

const rows = <T>(...r: T[]) => ({ rows: r });

beforeEach(() => {
  poolQuery.mockReset();
  txQuery.mockReset();
});

describe("scheduler.getAvailability", () => {
  it("returns full stock when there are no overlapping reservations", async () => {
    poolQuery
      .mockResolvedValueOnce(rows({ id: "item-1", slug: "tent", total_stock: 1, buffer_minutes: 0 }))
      .mockResolvedValueOnce(rows());

    const res = await scheduler.getAvailability({ itemSlug: "tent", startISO: START, endISO: END });

    expect(res).toMatchObject({
      itemSlug: "tent",
      itemId: "item-1",
      totalStock: 1,
      requested: 1,
      reserved: 0,
      available: 1,
      isAvailable: true,
    });
    expect(res.reservations).toEqual([]);
  });

  it("aggregates reserved quantity for a fungible item", async () => {
    poolQuery
      .mockResolvedValueOnce(rows({ id: "item-1", slug: "chairs", total_stock: 100, buffer_minutes: 0 }))
      .mockResolvedValueOnce(rows(makeRow({ quantity: 30 }), makeRow({ quantity: 40 })));

    const res = await scheduler.getAvailability({
      itemSlug: "chairs",
      startISO: START,
      endISO: END,
      quantity: 30,
    });

    expect(res.reserved).toBe(70);
    expect(res.available).toBe(30);
    expect(res.isAvailable).toBe(true);
  });

  it("is unavailable when the requested quantity exceeds remaining stock", async () => {
    poolQuery
      .mockResolvedValueOnce(rows({ id: "item-1", slug: "chairs", total_stock: 100, buffer_minutes: 0 }))
      .mockResolvedValueOnce(rows(makeRow({ quantity: 90 })));

    const res = await scheduler.getAvailability({
      itemSlug: "chairs",
      startISO: START,
      endISO: END,
      quantity: 20,
    });

    expect(res.available).toBe(10);
    expect(res.isAvailable).toBe(false);
  });

  it("throws SchedulerError for an unknown item", async () => {
    poolQuery.mockResolvedValueOnce(rows());
    await expect(
      scheduler.getAvailability({ itemSlug: "nope", startISO: START, endISO: END }),
    ).rejects.toBeInstanceOf(SchedulerError);
  });

  it("widens the overlap window by the item's buffer_minutes on both sides", async () => {
    poolQuery
      .mockResolvedValueOnce(rows({ id: "item-1", slug: "tent", total_stock: 1, buffer_minutes: 30 }))
      .mockResolvedValueOnce(rows());

    await scheduler.getAvailability({ itemSlug: "tent", startISO: START, endISO: END });

    const [, params] = poolQuery.mock.calls[1];
    expect(params).toEqual(["item-1", "2026-08-01T13:30:00.000Z", "2026-08-01T16:30:00.000Z"]);
  });

  it("lets an explicit bufferMinutes override the item's buffer_minutes", async () => {
    poolQuery
      .mockResolvedValueOnce(rows({ id: "item-1", slug: "tent", total_stock: 1, buffer_minutes: 30 }))
      .mockResolvedValueOnce(rows());

    await scheduler.getAvailability({
      itemSlug: "tent",
      startISO: START,
      endISO: END,
      bufferMinutes: 0,
    });

    const [, params] = poolQuery.mock.calls[1];
    expect(params).toEqual(["item-1", START, END]);
  });
});

describe("scheduler.createReservation (P2.1 single-item race-safe write)", () => {
  it("locks, re-checks capacity, then inserts (in that order) as a 'block' by default", async () => {
    txQuery
      .mockResolvedValueOnce(rows()) // pg_advisory_xact_lock
      .mockResolvedValueOnce(rows({ id: "item-1", slug: "tent", total_stock: 1, buffer_minutes: 0 }))
      .mockResolvedValueOnce(rows({ reserved: 0 })) // capacity SUM
      .mockResolvedValueOnce(rows(makeRow())); // INSERT ... RETURNING

    const res = await scheduler.createReservation({ itemSlug: "tent", startISO: START, endISO: END });

    expect(res.id).toBe(UUID);
    expect(res.itemSlug).toBe("tent");
    expect(res.status).toBe("block");

    const sql = txQuery.mock.calls.map((c) => String(c[0]));
    expect(sql[0]).toContain("pg_advisory_xact_lock");
    expect(sql[1]).toContain("FROM items");
    expect(sql[2]).toContain("SUM(quantity)");
    expect(sql[3]).toContain("INSERT INTO reservations");
  });

  it("widens the capacity window by the item's buffer_minutes", async () => {
    txQuery
      .mockResolvedValueOnce(rows())
      .mockResolvedValueOnce(rows({ id: "item-1", slug: "tent", total_stock: 1, buffer_minutes: 15 }))
      .mockResolvedValueOnce(rows({ reserved: 0 }))
      .mockResolvedValueOnce(rows(makeRow()));

    await scheduler.createReservation({ itemSlug: "tent", startISO: START, endISO: END });

    const capParams = txQuery.mock.calls[2][1];
    expect(capParams).toEqual([
      "item-1",
      "2026-08-01T13:45:00.000Z",
      "2026-08-01T16:15:00.000Z",
    ]);
  });

  it("persists group_id and series_id on the inserted row", async () => {
    const GROUP = "22222222-2222-4222-8222-222222222222";
    const SERIES = "33333333-3333-4333-8333-333333333333";
    txQuery
      .mockResolvedValueOnce(rows())
      .mockResolvedValueOnce(rows({ id: "item-1", slug: "tent", total_stock: 1, buffer_minutes: 0 }))
      .mockResolvedValueOnce(rows({ reserved: 0 }))
      .mockResolvedValueOnce(rows(makeRow({ group_id: GROUP, series_id: SERIES })));

    const res = await scheduler.createReservation({
      itemSlug: "tent",
      startISO: START,
      endISO: END,
      groupId: GROUP,
      seriesId: SERIES,
    });

    const insertParams = txQuery.mock.calls[3][1];
    expect(insertParams[10]).toBe(GROUP); // group_id
    expect(insertParams[11]).toBe(SERIES); // series_id
    expect(res.groupId).toBe(GROUP);
    expect(res.seriesId).toBe(SERIES);
  });

  it("throws SchedulerConflictError with meta and does not insert when full", async () => {
    txQuery
      .mockResolvedValueOnce(rows())
      .mockResolvedValueOnce(rows({ id: "item-1", slug: "tent", total_stock: 1, buffer_minutes: 0 }))
      .mockResolvedValueOnce(rows({ reserved: 1 })); // already full

    const err = await scheduler
      .createReservation({ itemSlug: "tent", startISO: START, endISO: END })
      .catch((e) => e);
    expect(err).toBeInstanceOf(SchedulerConflictError);
    expect(err.meta).toEqual({ itemSlug: "tent", requested: 1, available: 0 });

    const sql = txQuery.mock.calls.map((c) => String(c[0]));
    expect(sql.some((s) => s.includes("INSERT INTO reservations"))).toBe(false);
  });

  it("allows a fungible booking that exactly fills remaining capacity", async () => {
    txQuery
      .mockResolvedValueOnce(rows())
      .mockResolvedValueOnce(rows({ id: "item-1", slug: "chairs", total_stock: 100, buffer_minutes: 0 }))
      .mockResolvedValueOnce(rows({ reserved: 70 })) // 70 + 30 == 100
      .mockResolvedValueOnce(rows(makeRow({ quantity: 30 })));

    const res = await scheduler.createReservation({
      itemSlug: "chairs",
      startISO: START,
      endISO: END,
      quantity: 30,
    });
    expect(res.quantity).toBe(30);
  });

  it("rejects a fungible booking that would exceed capacity by one", async () => {
    txQuery
      .mockResolvedValueOnce(rows())
      .mockResolvedValueOnce(rows({ id: "item-1", slug: "chairs", total_stock: 100, buffer_minutes: 0 }))
      .mockResolvedValueOnce(rows({ reserved: 71 })); // 71 + 30 > 100

    await expect(
      scheduler.createReservation({ itemSlug: "chairs", startISO: START, endISO: END, quantity: 30 }),
    ).rejects.toBeInstanceOf(SchedulerConflictError);
  });

  it("throws SchedulerError for an unknown item inside the transaction", async () => {
    txQuery
      .mockResolvedValueOnce(rows()) // lock
      .mockResolvedValueOnce(rows()); // no item

    await expect(
      scheduler.createReservation({ itemSlug: "nope", startISO: START, endISO: END }),
    ).rejects.toBeInstanceOf(SchedulerError);
  });
});

describe("scheduler.getReservation / cancelReservation", () => {
  it("getReservation returns null without querying for a non-uuid id", async () => {
    expect(await scheduler.getReservation("not-a-uuid")).toBeNull();
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("getReservation returns a mapped reservation using the joined item slug", async () => {
    poolQuery.mockResolvedValueOnce(rows(makeRow({ item_slug: "tent" })));
    const res = await scheduler.getReservation(UUID);
    expect(res).toMatchObject({ id: UUID, itemSlug: "tent" });
  });

  it("cancelReservation returns the cancelled reservation on success", async () => {
    poolQuery.mockResolvedValueOnce(rows(makeRow({ status: "cancelled", item_slug: "tent" })));
    const res = await scheduler.cancelReservation(UUID);
    expect(res).toMatchObject({ id: UUID, itemSlug: "tent", status: "cancelled" });
  });

  it("cancelReservation returns null for an unknown reservation", async () => {
    poolQuery.mockResolvedValueOnce(rows());
    expect(await scheduler.cancelReservation(UUID)).toBeNull();
  });
});
