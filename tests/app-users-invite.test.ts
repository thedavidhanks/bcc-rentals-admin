import { describe, expect, it, vi } from "vitest";

// P6.6 — invite-by-email repository tests. Mirrors tests/repositories.test.ts:
// a recording fake Queryable client (a `query` vi.fn returning {rows,rowCount}),
// always passing an explicit client so no real pool/env is loaded. SQL + params
// are asserted with a whitespace-normalizer.

// Mock lib/db so importing the repository never triggers env validation (which
// needs runtime secrets absent in the test environment).
vi.mock("../lib/db", () => ({
  getPool: vi.fn(() => {
    throw new Error("getPool should not be called: tests pass explicit clients");
  }),
  withTransaction: vi.fn(),
}));

import type { Queryable } from "../lib/repositories/shared";
import {
  bindInvite,
  createInvite,
  getPendingInviteByEmail,
  InviteAlreadyExistsError,
  revokeInvite,
} from "../lib/repositories/app-users";

interface Call {
  text: string;
  values?: unknown[];
}

/**
 * A recording fake client. `results` is either a single {rows,rowCount} used for
 * every query, or an array consumed one-per-call (so createInvite's two queries
 * — the pre-check SELECT then the INSERT — can return different results).
 */
function makeClient(
  results:
    | { rows?: unknown[]; rowCount?: number }
    | Array<{ rows?: unknown[]; rowCount?: number } | Error> = {},
) {
  const calls: Call[] = [];
  const queue = Array.isArray(results) ? [...results] : null;
  const single = Array.isArray(results) ? null : results;
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    calls.push({ text, values });
    const r = queue ? queue.shift() ?? {} : single ?? {};
    if (r instanceof Error) throw r;
    return {
      rows: r.rows ?? [],
      rowCount: r.rowCount ?? (r.rows?.length ?? 0),
    };
  });
  return { client: { query } as unknown as Queryable, calls, query };
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function inviteRow(over: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    uid: null,
    email: "person@bachmancc.org",
    name: "Person",
    role: "scheduler",
    active: false,
    last_login: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...over,
  };
}

describe("getPendingInviteByEmail", () => {
  it("SELECTs scoped to uid IS NULL AND lower(email)=lower($1); returns the row", async () => {
    const row = inviteRow();
    const { client, calls } = makeClient({ rows: [row] });
    const result = await getPendingInviteByEmail("Person@BachmanCC.org", client);
    expect(result).toBe(row);
    const sql = norm(calls[0].text);
    expect(sql).toContain("SELECT");
    expect(sql).toContain("FROM app_users");
    expect(sql).toContain("uid IS NULL AND lower(email) = lower($1)");
    // The raw email is passed as-is; the SQL lower()s both sides.
    expect(calls[0].values).toEqual(["Person@BachmanCC.org"]);
  });

  it("returns null when no open invite matches", async () => {
    const { client } = makeClient({ rows: [] });
    expect(await getPendingInviteByEmail("nobody@x.org", client)).toBeNull();
  });
});

describe("createInvite", () => {
  it("pre-checks, then INSERTs uid=NULL, active=false, email lower-cased", async () => {
    // Call 1: pre-check SELECT finds nothing. Call 2: INSERT returns the row.
    const created = inviteRow({ email: "new@bachmancc.org" });
    const { client, calls } = makeClient([{ rows: [] }, { rows: [created] }]);

    const result = await createInvite(
      { email: "New@BachmanCC.ORG", name: "New Person", role: "scheduler" },
      client,
    );
    expect(result).toBe(created);

    // First query is the pre-check SELECT.
    expect(norm(calls[0].text)).toContain("uid IS NULL AND lower(email) = lower($1)");

    // Second query is the INSERT.
    const insertSql = norm(calls[1].text);
    expect(insertSql).toContain("INSERT INTO app_users");
    expect(insertSql).toContain("VALUES (NULL, $1, $2, $3, false, now(), now())");
    // Email is lower-cased before binding ($1); name ($2); role ($3).
    expect(calls[1].values).toEqual(["new@bachmancc.org", "New Person", "scheduler"]);
  });

  it("defaults name to null when omitted", async () => {
    const { client, calls } = makeClient([{ rows: [] }, { rows: [inviteRow()] }]);
    await createInvite({ email: "a@bachmancc.org", role: "admin" }, client);
    expect(calls[1].values).toEqual(["a@bachmancc.org", null, "admin"]);
  });

  it("rejects with InviteAlreadyExistsError when a pending invite already exists (pre-check)", async () => {
    // Pre-check SELECT returns an existing open invite → reject before INSERT.
    const { client, calls } = makeClient({ rows: [inviteRow()] });
    await expect(
      createInvite({ email: "person@bachmancc.org", role: "scheduler" }, client),
    ).rejects.toBeInstanceOf(InviteAlreadyExistsError);
    // Only the pre-check ran; the INSERT was never attempted.
    expect(calls).toHaveLength(1);
    expect(norm(calls[0].text)).toContain("SELECT");
  });

  it("rejects with InviteAlreadyExistsError when the INSERT hits a unique violation (23505)", async () => {
    // Pre-check passes (race window), then the partial unique index rejects the
    // concurrent duplicate with SQLSTATE 23505.
    const err = Object.assign(new Error("duplicate key"), { code: "23505" });
    const { client, calls } = makeClient([{ rows: [] }, err]);
    await expect(
      createInvite({ email: "person@bachmancc.org", role: "scheduler" }, client),
    ).rejects.toBeInstanceOf(InviteAlreadyExistsError);
    // Both the pre-check and the failing INSERT ran.
    expect(calls).toHaveLength(2);
    expect(norm(calls[1].text)).toContain("INSERT INTO app_users");
  });

  it("re-throws a non-unique-violation Postgres error unchanged", async () => {
    const err = Object.assign(new Error("connection reset"), { code: "08006" });
    const { client } = makeClient([{ rows: [] }, err]);
    await expect(
      createInvite({ email: "person@bachmancc.org", role: "scheduler" }, client),
    ).rejects.toBe(err);
  });
});

describe("bindInvite", () => {
  it("UPDATEs scoped to uid IS NULL, sets uid/active=true/last_login/updated_at", async () => {
    const bound = inviteRow({ uid: "real-uid", active: true });
    const { client, calls } = makeClient({ rows: [bound] });

    const result = await bindInvite(
      { email: "Person@BachmanCC.org", uid: "real-uid", name: "Bound Name" },
      client,
    );
    expect(result).toBe(bound);

    const sql = norm(calls[0].text);
    expect(sql).toContain("UPDATE app_users");
    expect(sql).toContain("SET uid = $2");
    expect(sql).toContain("active = true");
    expect(sql).toContain("last_login = now()");
    expect(sql).toContain("updated_at = now()");
    // Scoped so an invite binds at most once (WHERE uid IS NULL).
    expect(sql).toContain("WHERE uid IS NULL AND lower(email) = lower($1)");
    expect(calls[0].values).toEqual(["Person@BachmanCC.org", "real-uid", "Bound Name"]);
  });

  it("passes name=null through when omitted (COALESCE keeps existing name)", async () => {
    const { client, calls } = makeClient({ rows: [inviteRow({ uid: "u" })] });
    await bindInvite({ email: "p@bachmancc.org", uid: "u" }, client);
    expect(calls[0].values).toEqual(["p@bachmancc.org", "u", null]);
  });

  it("returns null when nothing matched — proves an invite binds at most once", async () => {
    // rowCount 0 / no rows: a second concurrent bind (invite already claimed) sees
    // no open row because the single UPDATE ... WHERE uid IS NULL is atomic.
    const { client } = makeClient({ rows: [], rowCount: 0 });
    expect(
      await bindInvite({ email: "already@bachmancc.org", uid: "loser" }, client),
    ).toBeNull();
  });
});

describe("revokeInvite", () => {
  it("DELETEs scoped to id=$1 AND uid IS NULL; returns true when a row was removed", async () => {
    const { client, calls } = makeClient({ rowCount: 1 });
    expect(await revokeInvite("inv-1", client)).toBe(true);
    const sql = norm(calls[0].text);
    expect(sql).toContain("DELETE FROM app_users WHERE id = $1 AND uid IS NULL");
    expect(calls[0].values).toEqual(["inv-1"]);
  });

  it("returns false when nothing was removed (already bound / not found)", async () => {
    const { client } = makeClient({ rowCount: 0 });
    expect(await revokeInvite("inv-1", client)).toBe(false);
  });
});
