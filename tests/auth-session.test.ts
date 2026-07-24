import { afterEach, describe, expect, it, vi } from "vitest";

// The session module imports lib/env (server secrets). Mock it per-test so we
// control NODE_ENV / AUTH_DEV_BYPASS without real env vars, then dynamic-import
// the module fresh (mirrors tests/env.test.ts).

async function loadSession(env: Record<string, string | undefined>) {
  vi.resetModules();
  vi.doMock("../lib/env", () => ({ env }));
  return import("../lib/auth/session");
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../lib/env");
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

  it("real path throws AuthNotConfiguredError until Q2 lands", async () => {
    const { createSession, AuthNotConfiguredError } = await loadSession({
      NODE_ENV: "production",
    });
    await expect(createSession({ idToken: "fake" })).rejects.toBeInstanceOf(
      AuthNotConfiguredError,
    );
  });

  it("verifying a non-dev cookie throws until Q2 lands (real seam)", async () => {
    const { verifySession, AuthNotConfiguredError } = await loadSession({
      NODE_ENV: "production",
    });
    await expect(verifySession("firebase-session-cookie")).rejects.toBeInstanceOf(
      AuthNotConfiguredError,
    );
  });
});
