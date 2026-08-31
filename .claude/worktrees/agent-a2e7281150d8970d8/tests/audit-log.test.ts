import { describe, expect, it, vi } from "vitest";

// Pass an explicit client throughout; mock lib/db so env validation (which needs
// runtime secrets) is not loaded.
vi.mock("../lib/db", () => ({
  getPool: vi.fn(() => {
    throw new Error("getPool should not be called: tests pass explicit clients");
  }),
  withTransaction: vi.fn(),
}));

import type { Queryable } from "../lib/repositories/shared";
import { writeAuditLog } from "../lib/repositories/audit-log";

interface Call {
  text: string;
  values?: unknown[];
}
function makeClient(rows: unknown[] = [{ id: "a1" }]) {
  const calls: Call[] = [];
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    calls.push({ text, values });
    return { rows, rowCount: rows.length };
  });
  return { client: { query } as unknown as Queryable, calls };
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("writeAuditLog (P3.2)", () => {
  it("inserts action/entity/actor and serializes detail to jsonb", async () => {
    const { client, calls } = makeClient();
    await writeAuditLog(
      {
        actor_uid: "uid-1",
        actor_email: "admin@bcc.org",
        action: "item.update",
        entity: "items",
        entity_id: "i1",
        detail: { before: { name: "A" }, after: { name: "B" } },
      },
      client,
    );
    const sql = norm(calls[0].text);
    expect(sql).toContain("INSERT INTO admin_audit_log");
    expect(sql).toContain("$6::jsonb");
    const values = calls[0].values!;
    expect(values[0]).toBe("uid-1");
    expect(values[1]).toBe("admin@bcc.org");
    expect(values[2]).toBe("item.update");
    expect(values[3]).toBe("items");
    expect(values[4]).toBe("i1");
    // detail is JSON-stringified for the jsonb column
    expect(values[5]).toBe(JSON.stringify({ before: { name: "A" }, after: { name: "B" } }));
  });

  it("normalizes missing detail/email/entity_id to null", async () => {
    const { client, calls } = makeClient();
    await writeAuditLog(
      { actor_uid: "uid-2", action: "reservation.cancel", entity: "reservations" },
      client,
    );
    const values = calls[0].values!;
    expect(values[1]).toBeNull(); // actor_email
    expect(values[4]).toBeNull(); // entity_id
    expect(values[5]).toBeNull(); // detail
  });

  it("returns the inserted row", async () => {
    const row = { id: "audit-1", action: "price.create" };
    const { client } = makeClient([row]);
    const result = await writeAuditLog(
      { actor_uid: "u", action: "price.create", entity: "item_prices" },
      client,
    );
    expect(result).toBe(row);
  });
});
