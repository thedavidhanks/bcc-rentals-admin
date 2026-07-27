import { afterEach, describe, expect, it, vi } from "vitest";

// The session module imports lib/env (server secrets). Mock it per-test so we
// control NODE_ENV / AUTH_DEV_BYPASS without real env vars, then dynamic-import
// the module fresh (mirrors tests/env.test.ts).

// session.ts imports firebase-admin (a heavy module tree). Always mock it in
// unit tests: the dev-bypass path never touches it, and the real path only needs
// the `getAuth()` return object. This also avoids a multi-second cold import.
function mockFirebaseAdmin(admin: Record<string, unknown>) {
  vi.doMock("firebase-admin/app", () => ({
    getApps: () => [{}],
    initializeApp: vi.fn(),
    applicationDefault: vi.fn(),
    cert: vi.fn(),
  }));
  vi.doMock("firebase-admin/auth", () => ({ getAuth: () => admin }));
}

async function loadSession(env: Record<string, string | undefined>) {
  vi.resetModules();
  vi.doMock("../lib/env", () => ({ env }));
  mockFirebaseAdmin({});
  return import("../lib/auth/session");
}

// Load the session module with firebase-admin's Auth mocked, for exercising the
// real (non-dev-bypass) path without a live Firebase project. `admin` becomes
// the object returned by `getAuth()`, so pass the Auth methods under test.
async function loadSessionWithAdmin(
  env: Record<string, string | undefined>,
  admin: Record<string, unknown>,
) {
  vi.resetModules();
  vi.doMock("../lib/env", () => ({ env }));
  mockFirebaseAdmin(admin);
  return import("../lib/auth/session");
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../lib/env");
  vi.doUnmock("firebase-admin/app");
  vi.doUnmock("firebase-admin/auth");
});

describe("isDevBypassEnabled", () => {
  it("is on in development by default", async () => {
    const { isDevBypassEnabled } = await loadSession({ NODE_ENV: "development" });
    expect(isDevBypassEnabled()).toBe(true);
  });

  it("is off in production regardless of the flag", async () => {
    const { isDevBypassEnabled } = await loadSession({
      NODE_ENV: "production",
      AUTH_DEV_BYPASS: "on",
    });
    expect(isDevBypassEnabled()).toBe(false);
  });

  it("can be forced off locally via AUTH_DEV_BYPASS=off", async () => {
    const { isDevBypassEnabled } = await loadSession({
      NODE_ENV: "development",
      AUTH_DEV_BYPASS: "off",
    });
    expect(isDevBypassEnabled()).toBe(false);
  });
});

describe("dev-bypass createSession + verifySession round-trip", () => {
  it("mints a stub cookie carrying the picked role and default uid/email", async () => {
    const { createSession, verifySession } = await loadSession({
      NODE_ENV: "development",
    });
    const { value, maxAgeSeconds } = await createSession({ devRole: "admin" });
    expect(value.startsWith("dev.")).toBe(true);
    expect(maxAgeSeconds).toBeGreaterThan(0);

    const identity = await verifySession(value);
    expect(identity).toEqual({
      uid: "dev-admin",
      email: "dev-admin@dev.local",
      role: "admin",
    });
  });

  it("honors explicit uid/email overrides", async () => {
    const { createSession, verifySession } = await loadSession({
      NODE_ENV: "development",
    });
    const { value } = await createSession({
      devRole: "scheduler",
      uid: "u-42",
      email: "sched@bachmancc.org",
    });
    const identity = await verifySession(value);
    expect(identity).toEqual({
      uid: "u-42",
      email: "sched@bachmancc.org",
      role: "scheduler",
    });
  });

  it("returns null for a missing cookie", async () => {
    const { verifySession } = await loadSession({ NODE_ENV: "development" });
    expect(await verifySession(undefined)).toBeNull();
    expect(await verifySession("")).toBeNull();
  });

  it("returns null for a corrupt stub cookie", async () => {
    const { verifySession } = await loadSession({ NODE_ENV: "development" });
    expect(await verifySession("dev.not-base64-json!!")).toBeNull();
  });
});

describe("production safety", () => {
  it("never honors a dev stub cookie when dev-bypass is off", async () => {
    // Mint the stub while dev-bypass is on...
    const dev = await loadSession({ NODE_ENV: "development" });
    const { value } = await dev.createSession({ devRole: "admin" });

    // ...then attempt to verify it as if we were in production.
    const prod = await loadSession({ NODE_ENV: "production" });
    expect(await prod.verifySession(value)).toBeNull();
  });

  it("createSession requires an idToken when dev-bypass is off", async () => {
    const { createSession } = await loadSession({ NODE_ENV: "production" });
    await expect(createSession({ devRole: "admin" })).rejects.toThrow(
      /requires an idToken/,
    );
  });

});

describe("real Firebase path (P4.2, firebase-admin mocked)", () => {
  it("createSession verifies the ID token then mints a session cookie", async () => {
    const verifyIdToken = vi.fn().mockResolvedValue({ uid: "fb-1" });
    const createSessionCookie = vi.fn().mockResolvedValue("fb.cookie.value");
    const { createSession } = await loadSessionWithAdmin(
      { NODE_ENV: "production", FIREBASE_PROJECT_ID: "bcc-admin-staging" },
      { verifyIdToken, createSessionCookie },
    );

    const minted = await createSession({ idToken: "id-token-abc" });

    expect(verifyIdToken).toHaveBeenCalledWith("id-token-abc", true);
    expect(createSessionCookie).toHaveBeenCalledWith("id-token-abc", {
      expiresIn: expect.any(Number),
    });
    expect(minted.value).toBe("fb.cookie.value");
    expect(minted.maxAgeSeconds).toBeGreaterThan(0);
  });

  it("createSession rejects when the ID token is invalid", async () => {
    const verifyIdToken = vi.fn().mockRejectedValue(new Error("token expired"));
    const createSessionCookie = vi.fn();
    const { createSession } = await loadSessionWithAdmin(
      { NODE_ENV: "production", FIREBASE_PROJECT_ID: "bcc-admin-staging" },
      { verifyIdToken, createSessionCookie },
    );

    await expect(createSession({ idToken: "bad" })).rejects.toThrow(/expired/);
    expect(createSessionCookie).not.toHaveBeenCalled();
  });

  it("verifySession returns the identity from a valid session cookie", async () => {
    const verifySessionCookie = vi
      .fn()
      .mockResolvedValue({ uid: "fb-9", email: "staff@bachmancc.org" });
    const { verifySession } = await loadSessionWithAdmin(
      { NODE_ENV: "production", FIREBASE_PROJECT_ID: "bcc-admin-staging" },
      { verifySessionCookie },
    );

    const identity = await verifySession("firebase-session-cookie");

    expect(verifySessionCookie).toHaveBeenCalledWith(
      "firebase-session-cookie",
      true,
    );
    expect(identity).toEqual({ uid: "fb-9", email: "staff@bachmancc.org" });
  });

  it("verifySession returns null for an invalid/revoked session cookie", async () => {
    const verifySessionCookie = vi
      .fn()
      .mockRejectedValue(new Error("cookie revoked"));
    const { verifySession } = await loadSessionWithAdmin(
      { NODE_ENV: "production", FIREBASE_PROJECT_ID: "bcc-admin-staging" },
      { verifySessionCookie },
    );

    expect(await verifySession("stale-cookie")).toBeNull();
  });
});
