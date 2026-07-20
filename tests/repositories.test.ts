import { describe, expect, it, vi } from "vitest";

// These tests always pass an explicit client, so the real pool/env is never
// needed — mock lib/db to avoid loading env validation (which requires runtime
// secrets that aren't set in the test environment).
vi.mock("../lib/db", () => ({
  getPool: vi.fn(() => {
    throw new Error("getPool should not be called: tests pass explicit clients");
  }),
  withTransaction: vi.fn(),
}));

import type { Queryable } from "../lib/repositories/shared";
import { buildSet } from "../lib/repositories/shared";
import {
  createItem,
  deactivateItem,
  listItems,
  updateItem,
} from "../lib/repositories/items";
import {
  createPrice,
  deletePrice,
  updatePrice,
} from "../lib/repositories/item-prices";
import { setItemCategories } from "../lib/repositories/item-categories";
import {
  cancelReservation,
  cancelReservationsBySeries,
  listReservationsInRange,
} from "../lib/repositories/reservations";
import {
  countActiveAdmins,
  getUserByUid,
  upsertUser,
} from "../lib/repositories/app-users";

// A recording fake that satisfies the `Queryable` shape. It captures every
// (text, values) pair so tests can assert on the SQL and the bound parameters
// without touching a real database.
interface Call {
  text: string;
  values?: unknown[];
}
function makeClient(result: { rows?: unknown[]; rowCount?: number } = {}) {
  const calls: Call[] = [];
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    calls.push({ text, values });
    return {
      rows: result.rows ?? [],
      rowCount: result.rowCount ?? (result.rows?.length ?? 0),
    };
  });
  return {
    client: { query } as unknown as Queryable,
    calls,
    query,
  };
}

// Collapse whitespace so assertions aren't sensitive to SQL formatting.
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("buildSet", () => {
  it("emits only present columns, keeps null, skips undefined", () => {
    const { clause, values, nextIndex } = buildSet(
      { name: "New", active: false, notes: null, skip: undefined },
      ["name", "active", "notes", "skip"],
    );
    expect(clause).toBe("name = $1, active = $2, notes = $3");
    expect(values).toEqual(["New", false, null]);
    expect(nextIndex).toBe(4);
  });

  it("honors a custom start index", () => {
    const { clause, nextIndex } = buildSet({ a: 1 }, ["a"], 5);
    expect(clause).toBe("a = $5");
    expect(nextIndex).toBe(6);
  });
});

describe("items repository", () => {
  it("createItem inserts with now() and returns the row", async () => {
    const row = { id: "i1", slug: "tent" };
    const { client, calls } = makeClient({ rows: [row] });
    const result = await createItem(
      { slug: "tent", name: "Tent", type: "unique", total_stock: 1, pricing_unit: "day" },
      client,
    );
    expect(result).toBe(row);
    const sql = norm(calls[0].text);
    expect(sql).toContain("INSERT INTO items");
    expect(sql).toContain("now()");
    expect(calls[0].values?.[0]).toBe("tent");
  });

  it("updateItem always bumps updated_at and puts id last", async () => {
    const { client, calls } = makeClient({ rows: [{ id: "i1" }] });
    await updateItem("i1", { name: "Renamed", active: false }, client);
    const sql = norm(calls[0].text);
    expect(sql).toContain("UPDATE items SET name = $1, active = $2, updated_at = now()");
    expect(sql).toContain("WHERE id = $3");
    expect(calls[0].values).toEqual(["Renamed", false, "i1"]);
  });

  it("updateItem with an empty patch still sets updated_at = now()", async () => {
    const { client, calls } = makeClient({ rows: [{ id: "i1" }] });
    await updateItem("i1", {}, client);
    const sql = norm(calls[0].text);
    expect(sql).toContain("SET updated_at = now() WHERE id = $1");
    expect(calls[0].values).toEqual(["i1"]);
  });

  it("deactivateItem sets active=false, not a delete", async () => {
    const { client, calls } = makeClient({ rows: [{ id: "i1" }] });
    await deactivateItem("i1", client);
    const sql = norm(calls[0].text);
    expect(sql).toContain("SET active = false, updated_at = now()");
    expect(sql).not.toContain("DELETE");
  });

  it("listItems applies the active-only filter when requested", async () => {
    const { client, calls } = makeClient({ rows: [] });
    await listItems({ activeOnly: true }, client);
    expect(norm(calls[0].text)).toContain("WHERE active = true");
  });
});

describe("item_prices repository", () => {
  it("createPrice passes cents and day/time scope in order", async () => {
    const { client, calls } = makeClient({ rows: [{ id: "p1" }] });
    await createPrice(
      { item_id: "i1", price_cents: 5000, days_of_week: [0, 6], start_minute: 540, end_minute: 1020 },
      client,
    );
    expect(norm(calls[0].text)).toContain("INSERT INTO item_prices");
    expect(calls[0].values).toEqual(["i1", 5000, [0, 6], 540, 1020, null, null]);
  });

  it("updatePrice builds a set clause and bumps updated_at", async () => {
    const { client, calls } = makeClient({ rows: [{ id: "p1" }] });
    await updatePrice("p1", { price_cents: 7500 }, client);
    const sql = norm(calls[0].text);
    expect(sql).toContain("price_cents = $1, updated_at = now()");
    expect(calls[0].values).toEqual([7500, "p1"]);
  });

  it("deletePrice returns true only when a row was removed", async () => {
    const hit = makeClient({ rowCount: 1 });
    expect(await deletePrice("p1", hit.client)).toBe(true);
    const miss = makeClient({ rowCount: 0 });
    expect(await deletePrice("p1", miss.client)).toBe(false);
  });
});

describe("item_categories repository", () => {
  it("setItemCategories deletes then multi-row inserts atomically", async () => {
    const { client, calls } = makeClient({ rowCount: 1 });
    await setItemCategories("i1", ["c1", "c2"], client);
    expect(norm(calls[0].text)).toContain("DELETE FROM item_categories WHERE item_id = $1");
    const insertSql = norm(calls[1].text);
    expect(insertSql).toContain("VALUES ($1, $2), ($1, $3)");
    expect(calls[1].values).toEqual(["i1", "c1", "c2"]);
  });

  it("setItemCategories with an empty list only deletes", async () => {
    const { client, calls } = makeClient({ rowCount: 0 });
    await setItemCategories("i1", [], client);
    expect(calls).toHaveLength(1);
    expect(norm(calls[0].text)).toContain("DELETE FROM item_categories");
  });
});

describe("reservations repository", () => {
  it("listReservationsInRange uses the half-open overlap predicate and excludes cancelled", async () => {
    const { client, calls } = makeClient({ rows: [] });
    const start = new Date("2026-07-20T00:00:00Z");
    const end = new Date("2026-07-27T00:00:00Z");
    await listReservationsInRange(start, end, {}, client);
    const sql = norm(calls[0].text);
    expect(sql).toContain("NOT (end_at <= $1 OR start_at >= $2)");
    expect(sql).toContain("status <> 'cancelled'");
    expect(calls[0].values).toEqual([start, end]);
  });

  it("listReservationsInRange can include cancelled", async () => {
    const { client, calls } = makeClient({ rows: [] });
    await listReservationsInRange(new Date(), new Date(), { includeCancelled: true }, client);
    expect(norm(calls[0].text)).not.toContain("status <> 'cancelled'");
  });

  it("cancelReservation sets status='cancelled' (no hard delete)", async () => {
    const { client, calls } = makeClient({ rows: [{ id: "r1" }] });
    await cancelReservation("r1", client);
    const sql = norm(calls[0].text);
    expect(sql).toContain("SET status = 'cancelled'");
    expect(sql).not.toContain("DELETE");
  });

  it("cancelReservationsBySeries cancels future rows only by default", async () => {
    const { client, calls } = makeClient({ rowCount: 3 });
    const n = await cancelReservationsBySeries("s1", {}, client);
    expect(n).toBe(3);
    const sql = norm(calls[0].text);
    expect(sql).toContain("series_id = $1");
    expect(sql).toContain("start_at >= $2");
  });

  it("cancelReservationsBySeries includePast cancels everything", async () => {
    const { client, calls } = makeClient({ rowCount: 5 });
    await cancelReservationsBySeries("s1", { includePast: true }, client);
    expect(norm(calls[0].text)).not.toContain("start_at >=");
    expect(calls[0].values).toEqual(["s1"]);
  });
});

describe("app_users repository", () => {
  it("getUserByUid returns null when absent", async () => {
    const { client } = makeClient({ rows: [] });
    expect(await getUserByUid("nope", client)).toBeNull();
  });

  it("upsertUser lowercases the email and upserts on uid conflict", async () => {
    const { client, calls } = makeClient({ rows: [{ id: "u1" }] });
    await upsertUser({ uid: "abc", email: "Person@Example.ORG", role: "admin" }, client);
    const sql = norm(calls[0].text);
    expect(sql).toContain("ON CONFLICT (uid) DO UPDATE");
    expect(calls[0].values?.[1]).toBe("person@example.org");
  });

  it("countActiveAdmins parses the count", async () => {
    const { client } = makeClient({ rows: [{ count: 2 }] });
    expect(await countActiveAdmins(client)).toBe(2);
  });
});
