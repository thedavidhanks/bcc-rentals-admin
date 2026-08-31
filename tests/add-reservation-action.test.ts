import { beforeEach, describe, expect, it, vi } from "vitest";

// Add Reservation server action tests (execution-plan P6.1).
//
// We mock the Postgres seam exactly like tests/scheduler-booking.test.ts: a
// single transaction client (txQuery) drives the whole atomic write, and we route
// responses by SQL text. requireScheduler is mocked to a fake scheduler user, and
// next/cache + next/navigation are stubbed so revalidatePath/redirect are inert
// (redirect throws a NEXT_REDIRECT sentinel like the real one).

// Everything referenced inside a vi.mock factory must be created via vi.hoisted
// so it exists when the (hoisted) mock factories run.
const { txQuery, requireScheduler, listItems, revalidatePath, redirect, RedirectSignal } =
  vi.hoisted(() => {
    class RedirectSignal extends Error {
      digest: string;
      constructor(path: string) {
        super(`NEXT_REDIRECT;${path}`);
        this.digest = `NEXT_REDIRECT;replace;${path};307;`;
      }
    }
    return {
      txQuery: vi.fn(),
      requireScheduler: vi.fn(async () => ({
        uid: "uid-scheduler",
        email: "sched@bachmancc.org",
        role: "scheduler" as const,
      })),
      listItems: vi.fn(async () => [
        { slug: "auditorium", name: "Auditorium" },
        { slug: "chairs", name: "Chairs" },
        { slug: "tent", name: "Tent" },
      ]),
      revalidatePath: vi.fn(),
      redirect: vi.fn((path: string) => {
        throw new RedirectSignal(path);
      }),
      RedirectSignal,
    };
  });

vi.mock("@/lib/db", () => ({
  getPool: () => ({ query: vi.fn() }),
  withTransaction: (fn: (client: { query: typeof txQuery }) => Promise<unknown>) =>
    fn({ query: txQuery }),
}));

vi.mock("@/lib/auth/guards", () => ({ requireScheduler }));
vi.mock("@/lib/repositories/items", () => ({ listItems }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));

import { createReservationAction } from "@/app/reservations/new/actions";
import { initialCreateReservationState } from "@/app/reservations/new/types";

const rows = <T>(...r: T[]) => ({ rows: r });

// Item capacity fixtures keyed by slug. `reserved` is the DB SUM returned.
type ItemFixture = { id: string; total_stock: number; buffer_minutes: number; reserved: number };

// pg returns real UUIDs; the booking schema validates seriesId/groupId as uuid,
// so the fixtures must be UUID-shaped (not "series-0").
const uuid = (n: number) =>
  `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const SERIES_UUID = uuid(1);

function installDb(items: Record<string, ItemFixture>) {
  let groupSeq = 100;
  let resvSeq = 200;
  let auditSeq = 300;
  txQuery.mockReset();
  txQuery.mockImplementation(async (sql: string, params: unknown[]) => {
    const s = String(sql);
    if (s.includes("pg_advisory_xact_lock")) return rows();
    if (s.includes("INSERT INTO reservation_series")) {
      return rows({ id: SERIES_UUID });
    }
    if (s.includes("INSERT INTO admin_audit_log")) {
      return rows({ id: uuid(auditSeq++) });
    }
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
      return rows({ id: uuid(groupSeq++) });
    }
    if (s.includes("INSERT INTO reservations")) {
      return rows({
        id: uuid(resvSeq++),
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

const sqlList = () => txQuery.mock.calls.map((c) => String(c[0]));
const callsMatching = (needle: string) =>
  txQuery.mock.calls.filter((c) => String(c[0]).includes(needle));

/** Build a FormData for one line item plus optional extra fields. */
function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
    else fd.set(k, v);
  }
  return fd;
}

const ONE_LINE = {
  "line-0-itemSlug": "auditorium",
  "line-0-quantity": "1",
  "line-0-date": "2026-08-02",
  "line-0-startMinute": "09:00",
  "line-0-endMinute": "12:00",
};

beforeEach(() => {
  txQuery.mockReset();
  revalidatePath.mockReset();
  redirect.mockClear();
  requireScheduler.mockClear();
  listItems.mockClear();
});

describe("createReservationAction — authorization", () => {
  it("calls requireScheduler before doing anything", async () => {
    installDb({ auditorium: { id: "item-aud", total_stock: 1, buffer_minutes: 0, reserved: 0 } });
    await createReservationAction(initialCreateReservationState, form(ONE_LINE)).catch(
      () => undefined,
    );
    expect(requireScheduler).toHaveBeenCalledTimes(1);
  });
});

describe("createReservationAction — single-item one-off (happy path)", () => {
  it("writes one group, one reservation row, and an audit row; then redirects", async () => {
    installDb({ auditorium: { id: "item-aud", total_stock: 1, buffer_minutes: 0, reserved: 0 } });

    const err = await createReservationAction(
      initialCreateReservationState,
      form(ONE_LINE),
    ).catch((e) => e);

    // Success path redirects to /calendar (throws the NEXT_REDIRECT sentinel).
    expect(err).toBeInstanceOf(RedirectSignal);
    expect(redirect).toHaveBeenCalledWith("/calendar");
    expect(revalidatePath).toHaveBeenCalledWith("/calendar");

    // One group, one reservation, one audit row; NO series (one-off).
    expect(callsMatching("INSERT INTO reservation_groups")).toHaveLength(1);
    expect(callsMatching("INSERT INTO reservations")).toHaveLength(1);
    expect(callsMatching("INSERT INTO admin_audit_log")).toHaveLength(1);
    expect(callsMatching("INSERT INTO reservation_series")).toHaveLength(0);

    // Audit row records the actor + action.
    const auditParams = callsMatching("INSERT INTO admin_audit_log")[0][1] as unknown[];
    expect(auditParams[0]).toBe("uid-scheduler"); // actor_uid
    expect(auditParams[2]).toBe("reservation.create"); // action
    expect(auditParams[3]).toBe("reservation_groups"); // entity
  });

  it("converts Eastern date + HH:MM into offset-correct instants (EDT summer)", async () => {
    installDb({ auditorium: { id: "item-aud", total_stock: 1, buffer_minutes: 0, reserved: 0 } });

    await createReservationAction(initialCreateReservationState, form(ONE_LINE)).catch(
      () => undefined,
    );

    // 2026-08-02 09:00 America/New_York (EDT, UTC-4) → 13:00Z.
    const resvParams = callsMatching("INSERT INTO reservations")[0][1] as unknown[];
    expect(resvParams[2]).toBe("2026-08-02T13:00:00.000Z"); // start_at
    expect(resvParams[3]).toBe("2026-08-02T16:00:00.000Z"); // end_at
  });
});

describe("createReservationAction — multi-item one-off", () => {
  it("writes one group with N reservation rows", async () => {
    installDb({
      auditorium: { id: "item-aud", total_stock: 1, buffer_minutes: 0, reserved: 0 },
      chairs: { id: "item-chairs", total_stock: 300, buffer_minutes: 0, reserved: 0 },
      tent: { id: "item-tent", total_stock: 5, buffer_minutes: 0, reserved: 0 },
    });

    const err = await createReservationAction(
      initialCreateReservationState,
      form({
        "line-0-itemSlug": "auditorium",
        "line-0-quantity": "1",
        "line-0-date": "2026-08-02",
        "line-0-startMinute": "08:00",
        "line-0-endMinute": "18:00",
        "line-1-itemSlug": "chairs",
        "line-1-quantity": "200",
        "line-1-date": "2026-08-02",
        "line-1-startMinute": "08:00",
        "line-1-endMinute": "18:00",
        "line-2-itemSlug": "tent",
        "line-2-quantity": "2",
        "line-2-date": "2026-08-02",
        "line-2-startMinute": "08:00",
        "line-2-endMinute": "18:00",
      }),
    ).catch((e) => e);

    expect(err).toBeInstanceOf(RedirectSignal);
    expect(callsMatching("INSERT INTO reservation_groups")).toHaveLength(1);
    expect(callsMatching("INSERT INTO reservations")).toHaveLength(3);
    expect(callsMatching("INSERT INTO reservation_series")).toHaveLength(0);
  });
});

describe("createReservationAction — recurring", () => {
  it("creates a series row and one group per occurrence, all carrying series_id", async () => {
    installDb({ auditorium: { id: "item-aud", total_stock: 1, buffer_minutes: 0, reserved: 0 } });

    const err = await createReservationAction(
      initialCreateReservationState,
      form({
        ...ONE_LINE,
        recurring: "on",
        "recurrence-freq": "weekly",
        "recurrence-interval": "1",
        "recurrence-endMode": "count",
        "recurrence-count": "3",
      }),
    ).catch((e) => e);

    expect(err).toBeInstanceOf(RedirectSignal);

    // One series, three groups (one per occurrence), three reservation rows.
    expect(callsMatching("INSERT INTO reservation_series")).toHaveLength(1);
    expect(callsMatching("INSERT INTO reservation_groups")).toHaveLength(3);
    expect(callsMatching("INSERT INTO reservations")).toHaveLength(3);

    // Every reservation row carries the same series_id (param index 11).
    const seriesIds = callsMatching("INSERT INTO reservations").map(
      (c) => (c[1] as unknown[])[11],
    );
    expect(new Set(seriesIds)).toEqual(new Set([SERIES_UUID]));

    // Groups also carry the series_id (reservation_groups param index 5).
    const groupSeriesIds = callsMatching("INSERT INTO reservation_groups").map(
      (c) => (c[1] as unknown[])[5],
    );
    expect(new Set(groupSeriesIds)).toEqual(new Set([SERIES_UUID]));

    // Audit entity_id points at the series id for a recurring booking.
    const auditParams = callsMatching("INSERT INTO admin_audit_log")[0][1] as unknown[];
    expect(auditParams[4]).toBe(SERIES_UUID);
  });

  it("passes byWeekday and interval through to the series row for a weekly rule", async () => {
    installDb({ auditorium: { id: "item-aud", total_stock: 1, buffer_minutes: 0, reserved: 0 } });

    await createReservationAction(
      initialCreateReservationState,
      form({
        ...ONE_LINE,
        recurring: "on",
        "recurrence-freq": "weekly",
        "recurrence-interval": "2",
        "recurrence-byWeekday": ["0", "2"], // Sun + Tue
        "recurrence-endMode": "count",
        "recurrence-count": "4",
      }),
    ).catch(() => undefined);

    const seriesParams = callsMatching("INSERT INTO reservation_series")[0][1] as unknown[];
    // repo insert order: freq, interval, by_weekday, starts_on, until_date, count, created_by
    expect(seriesParams[0]).toBe("weekly");
    expect(seriesParams[1]).toBe(2);
    expect(seriesParams[2]).toEqual([0, 2]);
    expect(seriesParams[5]).toBe(4);
    expect(seriesParams[6]).toBe("uid-scheduler");
  });
});

describe("createReservationAction — all-or-nothing conflict", () => {
  it("catches GroupBookingConflictError, commits nothing, and lists failing item×date", async () => {
    installDb({
      auditorium: { id: "item-aud", total_stock: 1, buffer_minutes: 0, reserved: 1 }, // full
      chairs: { id: "item-chairs", total_stock: 300, buffer_minutes: 0, reserved: 0 },
    });

    const state = await createReservationAction(
      initialCreateReservationState,
      form({
        "line-0-itemSlug": "auditorium",
        "line-0-quantity": "1",
        "line-0-date": "2026-08-02",
        "line-0-startMinute": "09:00",
        "line-0-endMinute": "12:00",
        "line-1-itemSlug": "chairs",
        "line-1-quantity": "50",
        "line-1-date": "2026-08-02",
        "line-1-startMinute": "09:00",
        "line-1-endMinute": "12:00",
      }),
    );

    // Returned a failure state (no redirect thrown).
    expect(redirect).not.toHaveBeenCalled();
    expect(state.status).toBe("error");
    expect(state.conflicts).toBeDefined();
    expect(state.conflicts).toHaveLength(1);
    expect(state.conflicts![0]).toMatchObject({
      itemSlug: "auditorium",
      date: "2026-08-02",
      requested: 1,
      available: 0,
    });

    // All-or-nothing: nothing was inserted.
    const sql = sqlList();
    expect(sql.some((s) => s.includes("INSERT INTO reservation_groups"))).toBe(false);
    expect(sql.some((s) => s.includes("INSERT INTO reservations"))).toBe(false);
    expect(sql.some((s) => s.includes("INSERT INTO admin_audit_log"))).toBe(false);
  });
});

describe("createReservationAction — validation", () => {
  it("rejects unknown / inactive item slugs before writing", async () => {
    installDb({ auditorium: { id: "item-aud", total_stock: 1, buffer_minutes: 0, reserved: 0 } });

    const state = await createReservationAction(
      initialCreateReservationState,
      form({ ...ONE_LINE, "line-0-itemSlug": "ghost" }),
    );

    expect(state.status).toBe("error");
    expect(state.message).toContain("ghost");
    expect(redirect).not.toHaveBeenCalled();
    // Never reached the DB write path.
    expect(sqlList()).toHaveLength(0);
  });

  it("returns field errors when end time is not after start time", async () => {
    installDb({ auditorium: { id: "item-aud", total_stock: 1, buffer_minutes: 0, reserved: 0 } });

    const state = await createReservationAction(
      initialCreateReservationState,
      form({ ...ONE_LINE, "line-0-startMinute": "12:00", "line-0-endMinute": "09:00" }),
    );

    expect(state.status).toBe("error");
    expect(state.fieldErrors).toBeDefined();
    expect(redirect).not.toHaveBeenCalled();
  });
});
