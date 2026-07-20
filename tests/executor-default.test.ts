import { describe, expect, it, vi } from "vitest";

// Verify that a repository call with NO explicit client falls back to the
// shared pool via getPool(). We mock lib/db so no real Pool/env is needed.

const query = vi.fn(async () => ({ rows: [{ id: "i1" }], rowCount: 1 }));
const getPool = vi.fn(() => ({ query }));

vi.mock("../lib/db", () => ({
  getPool,
  withTransaction: vi.fn(),
}));

describe("executor default (no client → shared pool)", () => {
  it("routes a clientless repo call through getPool()", async () => {
    const { getItemById } = await import("../lib/repositories/items");
    await getItemById("i1");
    expect(getPool).toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
