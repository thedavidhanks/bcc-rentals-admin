import { afterEach, describe, expect, it, vi } from "vitest";

// Baseline set of valid NEXT_PUBLIC_* values used by the tests below.
const validPublicEnv = {
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  NEXT_PUBLIC_FIREBASE_API_KEY: "test-api-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "bcc-rentals.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "bcc-rentals",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:123:web:abc",
};

function setPublicEnv(overrides: Record<string, string | undefined> = {}) {
  for (const [key, value] of Object.entries({ ...validPublicEnv, ...overrides })) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

afterEach(() => {
  vi.resetModules();
});

describe("public-env", () => {
  it("parses when all required NEXT_PUBLIC_* vars are present", async () => {
    vi.resetModules();
    setPublicEnv();
    const mod = await import("../lib/public-env");
    expect(mod.publicEnv.NEXT_PUBLIC_FIREBASE_PROJECT_ID).toBe("bcc-rentals");
    expect(mod.publicEnv.NEXT_PUBLIC_SITE_URL).toBe("http://localhost:3000");
  });

  it("throws when a required NEXT_PUBLIC_* var is missing", async () => {
    vi.resetModules();
    setPublicEnv({ NEXT_PUBLIC_FIREBASE_API_KEY: undefined });
    await expect(import("../lib/public-env")).rejects.toThrow(
      /Invalid public environment/,
    );
  });

  it("rejects a non-URL NEXT_PUBLIC_SITE_URL", async () => {
    vi.resetModules();
    setPublicEnv({ NEXT_PUBLIC_SITE_URL: "not-a-url" });
    await expect(import("../lib/public-env")).rejects.toThrow(/valid URL/);
  });
});
