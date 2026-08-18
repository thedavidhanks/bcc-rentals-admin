import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionIdentity } from "../lib/auth/types";
import type { AppUserRow } from "../lib/repositories/types";

// P6.6 — invite-binding security matrix for getSessionUser (lib/auth/guards.ts).
// Mirrors tests/auth-guards.test.ts: vi.doMock of next/headers, next/navigation,
// lib/auth/session, lib/repositories/app-users, lib/repositories/audit-log,
// lib/db, lib/env, then a dynamic import of the module under test after mocks.
//
// The bind path runs inside withTransaction; we give it a client and let the
// mocked bindInvite decide the outcome. The security guarantees under test:
//   - email_verified must be true before ANY bind is attempted (no takeover).
//   - a returning UID (getUserByUid hit) never reaches the bind path.
//   - the domain gate is re-applied to the bound email.
//   - bindInvite returning null (no invite / lost race) → deny, no row created.

const cookieValue = { current: "cookie-raw" as string | undefined };

function mockAll(opts: {
  identity: SessionIdentity | null;
  dbUser?: AppUserRow | null;
  boundRow?: AppUserRow | null;
  allowedDomain?: string;
}) {
  vi.resetModules();

  const get = vi.fn(() => (cookieValue.current ? { value: cookieValue.current } : undefined));
  vi.doMock("next/headers", () => ({ cookies: vi.fn(async () => ({ get })) }));

  const redirect = vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  });
  vi.doMock("next/navigation", () => ({ redirect }));

  const verifySession = vi.fn(async () => opts.identity);
  vi.doMock("../lib/auth/session", () => ({ verifySession }));

  const getUserByUid = vi.fn(async () => opts.dbUser ?? null);
  const bindInvite = vi.fn(async () => opts.boundRow ?? null);
  vi.doMock("../lib/repositories/app-users", () => ({ getUserByUid, bindInvite }));

  const writeAuditLog = vi.fn(async () => ({}));
  vi.doMock("../lib/repositories/audit-log", () => ({ writeAuditLog }));

  const txClient = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };
  const withTransaction = vi.fn(async (fn: (client: unknown) => unknown) => fn(txClient));
  vi.doMock("../lib/db", () => ({ withTransaction }));

  vi.doMock("../lib/env", () => ({ env: { ALLOWED_EMAIL_DOMAIN: opts.allowedDomain } }));

  return { verifySession, getUserByUid, bindInvite, writeAuditLog, withTransaction, redirect };
}

function boundRow(over: Partial<AppUserRow> = {}): AppUserRow {
  return {
    id: "inv-1",
    uid: "real-uid",
    email: "invitee@bachmancc.org",
    name: "Invitee",
    role: "scheduler",
    active: true,
    last_login: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
    ...over,
  };
}

function activeRow(over: Partial<AppUserRow> = {}): AppUserRow {
  return {
    id: "u-1",
    uid: "existing-uid",
    email: "existing@bachmancc.org",
    name: "Existing",
    role: "admin",
    active: true,
    last_login: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...over,
  };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  cookieValue.current = "cookie-raw";
});

describe("getSessionUser — invite binding (P6.6)", () => {
  it("verified first sign-in + no db row + bindInvite returns a bound active row → returns that user and audits the bind", async () => {
    const { bindInvite, writeAuditLog } = mockAll({
      identity: { uid: "real-uid", email: "invitee@bachmancc.org", email_verified: true },
      dbUser: null,
      boundRow: boundRow(),
    });
    const { getSessionUser } = await import("../lib/auth/guards");

    const user = await getSessionUser();
    expect(user).toEqual({
      uid: "real-uid",
      role: "scheduler",
      email: "invitee@bachmancc.org",
    });
    expect(bindInvite).toHaveBeenCalledTimes(1);
    expect(bindInvite).toHaveBeenCalledWith(
      { email: "invitee@bachmancc.org", uid: "real-uid" },
      expect.anything(),
    );
    // The bind is audited with the correct action.
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.invite.bind",
        entity: "app_users",
        entity_id: "inv-1",
        actor_uid: "real-uid",
      }),
      expect.anything(),
    );
  });

  it("domain gate is re-applied to the bound email: allowed domain passes", async () => {
    mockAll({
      identity: { uid: "real-uid", email: "invitee@bachmancc.org", email_verified: true },
      dbUser: null,
      boundRow: boundRow({ email: "invitee@bachmancc.org" }),
      allowedDomain: "bachmancc.org",
    });
    const { getSessionUser } = await import("../lib/auth/guards");
    const user = await getSessionUser();
    expect(user?.uid).toBe("real-uid");
  });

  it("domain gate is re-applied to the bound email: disallowed domain → null", async () => {
    const { bindInvite } = mockAll({
      identity: { uid: "real-uid", email: "invitee@evil.com", email_verified: true },
      dbUser: null,
      boundRow: boundRow({ email: "invitee@evil.com" }),
      allowedDomain: "bachmancc.org",
    });
    const { getSessionUser } = await import("../lib/auth/guards");
    // The invite did bind, but the domain gate still denies the session.
    expect(await getSessionUser()).toBeNull();
    expect(bindInvite).toHaveBeenCalledTimes(1);
  });

  it("email_verified=false + no db row → bindInvite is NEVER called → deny", async () => {
    const { bindInvite, writeAuditLog } = mockAll({
      identity: { uid: "spoof", email: "invitee@bachmancc.org", email_verified: false },
      dbUser: null,
    });
    const { getSessionUser } = await import("../lib/auth/guards");
    expect(await getSessionUser()).toBeNull();
    expect(bindInvite).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("verified + no db row + no matching invite (bindInvite returns null) → deny, nothing created", async () => {
    const { bindInvite, writeAuditLog } = mockAll({
      identity: { uid: "stranger", email: "stranger@bachmancc.org", email_verified: true },
      dbUser: null,
      boundRow: null,
    });
    const { getSessionUser } = await import("../lib/auth/guards");
    expect(await getSessionUser()).toBeNull();
    expect(bindInvite).toHaveBeenCalledTimes(1);
    // No invite matched → no bind → no audit row written.
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("a UID that resolves via getUserByUid (already bound) → bindInvite is NEVER called", async () => {
    const { getUserByUid, bindInvite } = mockAll({
      identity: { uid: "existing-uid", email: "existing@bachmancc.org", email_verified: true },
      dbUser: activeRow(),
    });
    const { getSessionUser } = await import("../lib/auth/guards");
    const user = await getSessionUser();
    expect(user).toEqual({
      uid: "existing-uid",
      role: "admin",
      email: "existing@bachmancc.org",
    });
    expect(getUserByUid).toHaveBeenCalledWith("existing-uid");
    expect(bindInvite).not.toHaveBeenCalled();
  });

  it("concurrency / double-bind: second caller loses the race (bindInvite → null) → deny", async () => {
    // The single UPDATE ... WHERE uid IS NULL is the guarantee: the losing
    // concurrent caller finds no open row, bindInvite returns null, session denied.
    const { bindInvite } = mockAll({
      identity: { uid: "loser-uid", email: "invitee@bachmancc.org", email_verified: true },
      dbUser: null,
      boundRow: null,
    });
    const { getSessionUser } = await import("../lib/auth/guards");
    expect(await getSessionUser()).toBeNull();
    expect(bindInvite).toHaveBeenCalledTimes(1);
  });

  it("no email on the identity → bindInvite is never attempted → deny", async () => {
    const { bindInvite } = mockAll({
      identity: { uid: "no-email", email: null, email_verified: true },
      dbUser: null,
    });
    const { getSessionUser } = await import("../lib/auth/guards");
    expect(await getSessionUser()).toBeNull();
    expect(bindInvite).not.toHaveBeenCalled();
  });
});
