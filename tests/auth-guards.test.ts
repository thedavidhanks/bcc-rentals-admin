import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionIdentity } from "../lib/auth/types";
import type { AppUserRow } from "../lib/repositories/types";

// Guards depend on next/headers (cookies), next/navigation (redirect),
// lib/auth/session (verifySession), lib/repositories/app-users (getUserByUid),
// and lib/env (ALLOWED_EMAIL_DOMAIN). Mock all five so we test the guard logic
// (dev-role short-circuit, DB role lookup, deny-unknown, role checks) in
// isolation. `redirect` is mocked to throw a sentinel, matching how Next's real
// redirect() aborts control flow.

const cookieValue = { current: "cookie-raw" as string | undefined };

function mockAll(opts: {
  identity: SessionIdentity | null;
  dbUser?: AppUserRow | null;
  allowedDomain?: string;
}) {
  vi.resetModules();

  const get = vi.fn(() => (cookieValue.current ? { value: cookieValue.current } : undefined));
  vi.doMock("next/headers", () => ({
    cookies: vi.fn(async () => ({ get })),
  }));

  const redirect = vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  });
  vi.doMock("next/navigation", () => ({ redirect }));

  const verifySession = vi.fn(async () => opts.identity);
  vi.doMock("../lib/auth/session", () => ({ verifySession }));

  const getUserByUid = vi.fn(async () => opts.dbUser ?? null);
  const bindInvite = vi.fn(async () => null);
  vi.doMock("../lib/repositories/app-users", () => ({ getUserByUid, bindInvite }));

  const writeAuditLog = vi.fn(async () => ({}));
  vi.doMock("../lib/repositories/audit-log", () => ({ writeAuditLog }));

  // getSessionUser's invite-bind path (P6.6) runs inside withTransaction; give it
  // a client whose query is a no-op so the (rare) bind path doesn't hit a real DB.
  const withTransaction = vi.fn(async (fn: (client: unknown) => unknown) =>
    fn({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }),
  );
  vi.doMock("../lib/db", () => ({ withTransaction }));

  vi.doMock("../lib/env", () => ({
    env: { ALLOWED_EMAIL_DOMAIN: opts.allowedDomain },
  }));

  return { verifySession, getUserByUid, bindInvite, writeAuditLog, redirect };
}

function makeRow(over: Partial<AppUserRow> = {}): AppUserRow {
  return {
    id: "id-1",
    uid: "uid-1",
    email: "person@bachmancc.org",
    name: "Person",
    role: "scheduler",
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

describe("getSessionUser", () => {
  it("returns null when there is no valid session", async () => {
    mockAll({ identity: null });
    const { getSessionUser } = await import("../lib/auth/guards");
    expect(await getSessionUser()).toBeNull();
  });

  it("dev-bypass: trusts the role in the stub identity (no DB lookup)", async () => {
    const { getUserByUid } = mockAll({
      identity: {
        uid: "dev-admin",
        email: "dev-admin@dev.local",
        email_verified: true,
        role: "admin",
      },
    });
    const { getSessionUser } = await import("../lib/auth/guards");
    expect(await getSessionUser()).toEqual({
      uid: "dev-admin",
      role: "admin",
      email: "dev-admin@dev.local",
    });
    expect(getUserByUid).not.toHaveBeenCalled();
  });

  it("real path: resolves role from app_users by UID", async () => {
    const { getUserByUid } = mockAll({
      identity: { uid: "uid-1", email: "person@bachmancc.org", email_verified: true },
      dbUser: makeRow({ role: "admin" }),
    });
    const { getSessionUser } = await import("../lib/auth/guards");
    expect(await getSessionUser()).toEqual({
      uid: "uid-1",
      role: "admin",
      email: "person@bachmancc.org",
    });
    expect(getUserByUid).toHaveBeenCalledWith("uid-1");
  });

  it("denies an unknown user (no app_users row)", async () => {
    mockAll({
      identity: { uid: "ghost", email: "ghost@x.org", email_verified: false },
      dbUser: null,
    });
    const { getSessionUser } = await import("../lib/auth/guards");
    expect(await getSessionUser()).toBeNull();
  });

  it("denies a deactivated user", async () => {
    mockAll({
      identity: { uid: "uid-1", email: "person@bachmancc.org", email_verified: true },
      dbUser: makeRow({ active: false }),
    });
    const { getSessionUser } = await import("../lib/auth/guards");
    expect(await getSessionUser()).toBeNull();
  });

  it("enforces ALLOWED_EMAIL_DOMAIN when configured", async () => {
    mockAll({
      identity: { uid: "uid-1", email: "person@evil.com", email_verified: true },
      dbUser: makeRow({ email: "person@evil.com" }),
      allowedDomain: "bachmancc.org",
    });
    const { getSessionUser } = await import("../lib/auth/guards");
    expect(await getSessionUser()).toBeNull();
  });

  it("allows a matching ALLOWED_EMAIL_DOMAIN", async () => {
    mockAll({
      identity: { uid: "uid-1", email: "Person@BachmanCC.org", email_verified: true },
      dbUser: makeRow({ email: "Person@BachmanCC.org" }),
      allowedDomain: "bachmancc.org",
    });
    const { getSessionUser } = await import("../lib/auth/guards");
    const user = await getSessionUser();
    expect(user?.uid).toBe("uid-1");
  });
});

describe("requireScheduler", () => {
  it("redirects to /login when unauthenticated", async () => {
    mockAll({ identity: null });
    const { requireScheduler } = await import("../lib/auth/guards");
    await expect(requireScheduler()).rejects.toThrow("REDIRECT:/login");
  });

  it("allows a scheduler", async () => {
    mockAll({ identity: { uid: "u", email: null, email_verified: true, role: "scheduler" } });
    const { requireScheduler } = await import("../lib/auth/guards");
    const user = await requireScheduler();
    expect(user.role).toBe("scheduler");
  });

  it("allows an admin (admins have scheduler powers)", async () => {
    mockAll({ identity: { uid: "u", email: null, email_verified: true, role: "admin" } });
    const { requireScheduler } = await import("../lib/auth/guards");
    const user = await requireScheduler();
    expect(user.role).toBe("admin");
  });
});

describe("requireAdmin", () => {
  it("redirects to /login when unauthenticated", async () => {
    mockAll({ identity: null });
    const { requireAdmin } = await import("../lib/auth/guards");
    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/login");
  });

  it("throws ForbiddenError for a scheduler", async () => {
    mockAll({ identity: { uid: "u", email: null, email_verified: true, role: "scheduler" } });
    const { requireAdmin, ForbiddenError } = await import("../lib/auth/guards");
    await expect(requireAdmin()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("allows an admin", async () => {
    mockAll({ identity: { uid: "u", email: null, email_verified: true, role: "admin" } });
    const { requireAdmin } = await import("../lib/auth/guards");
    const user = await requireAdmin();
    expect(user.role).toBe("admin");
  });
});
