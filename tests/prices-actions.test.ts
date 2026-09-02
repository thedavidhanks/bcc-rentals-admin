import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ItemPriceRow } from "../lib/repositories/types";

// P6.3 — Update Prices server-action tests (app/prices/actions.ts). Mirrors
// tests/users-actions.test.ts: mock the guard, withTransaction, the repo fns,
// writeAuditLog + next/cache, drive each action with FormData, and assert the
// returned PriceActionState (or that requireScheduler's rejection propagates).
//
// Everything referenced inside a vi.mock factory is created via vi.hoisted so
// it exists when the hoisted factories run.
const {
  requireScheduler,
  withTransaction,
  writeAuditLog,
  createPrice,
  updatePrice,
  deletePrice,
  getPriceById,
  listPricesForItem,
  revalidatePath,
} = vi.hoisted(() => ({
  requireScheduler: vi.fn(async () => ({
    uid: "sched-uid",
    email: "sched@bachmancc.org",
    role: "scheduler" as const,
  })),
  withTransaction: vi.fn(
    async (fn: (client: unknown) => unknown) =>
      fn({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }),
  ),
  writeAuditLog: vi.fn(async (_entry: Record<string, unknown>, _client?: unknown) => ({})),
  createPrice: vi.fn(),
  updatePrice: vi.fn(),
  deletePrice: vi.fn(),
  getPriceById: vi.fn(),
  listPricesForItem: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ requireScheduler }));
vi.mock("@/lib/db", () => ({ withTransaction }));
vi.mock("@/lib/repositories/audit-log", () => ({ writeAuditLog }));
vi.mock("@/lib/repositories/item-prices", () => ({
  createPrice,
  updatePrice,
  deletePrice,
  getPriceById,
  listPricesForItem,
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  createPriceAction,
  deletePriceAction,
  updatePriceAction,
} from "@/app/prices/actions";
import { initialPriceActionState } from "@/app/prices/state";

// `undefined` omits the key entirely — needed to simulate an UNCHECKED
// checkbox (e.g. allHours), since a real unchecked checkbox is absent from
// FormData, not present with an empty string.
function form(fields: Record<string, string | string[] | undefined>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
    else fd.set(k, v);
  }
  return fd;
}

function priceRow(over: Partial<ItemPriceRow> = {}): ItemPriceRow {
  return {
    id: "price-1",
    item_id: "item-1",
    price_cents: 1000,
    days_of_week: null,
    start_minute: null,
    end_minute: null,
    priority: 0,
    label: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...over,
  };
}

/** A minimal all-days/all-hours override form payload (create/update). */
function baseFields(over: Record<string, string | string[] | undefined> = {}) {
  return {
    itemId: "item-1",
    price: "10.00",
    priority: "0",
    label: "",
    scope: "all",
    allHours: "on",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireScheduler.mockImplementation(async () => ({
    uid: "sched-uid",
    email: "sched@bachmancc.org",
    role: "scheduler" as const,
  }));
  withTransaction.mockImplementation(
    async (fn: (client: unknown) => unknown) =>
      fn({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }),
  );
  writeAuditLog.mockResolvedValue({});
  getPriceById.mockResolvedValue(priceRow());
  listPricesForItem.mockResolvedValue([priceRow()]);
});

const st = initialPriceActionState;

// ---------------------------------------------------------------------------
// Authorization: requireScheduler runs FIRST for every action.
// ---------------------------------------------------------------------------
describe("authorization — requireScheduler rejecting propagates for every action, no DB work", () => {
  const cases: Array<[string, (fd: FormData) => Promise<unknown>, FormData]> = [
    ["createPriceAction", (fd) => createPriceAction(st, fd), form(baseFields())],
    [
      "updatePriceAction",
      (fd) => updatePriceAction(st, fd),
      form({ id: "price-1", ...baseFields() }),
    ],
    [
      "deletePriceAction",
      (fd) => deletePriceAction(st, fd),
      form({ id: "price-1", itemId: "item-1" }),
    ],
  ];

  for (const [name, run, fd] of cases) {
    it(`${name} rejects when requireScheduler throws (unauthenticated/unauthorized)`, async () => {
      requireScheduler.mockRejectedValueOnce(new Error("Scheduler role required"));
      await expect(run(fd)).rejects.toThrow("Scheduler role required");
      expect(createPrice).not.toHaveBeenCalled();
      expect(updatePrice).not.toHaveBeenCalled();
      expect(deletePrice).not.toHaveBeenCalled();
      expect(getPriceById).not.toHaveBeenCalled();
      expect(listPricesForItem).not.toHaveBeenCalled();
      expect(writeAuditLog).not.toHaveBeenCalled();
    });
  }
});

// ---------------------------------------------------------------------------
// createPriceAction
// ---------------------------------------------------------------------------
describe("createPriceAction", () => {
  it("valid all-days/all-hours row → createPrice + audit(price.create), success", async () => {
    createPrice.mockResolvedValue(priceRow({ id: "new-1", price_cents: 1000 }));
    const result = await createPriceAction(st, form(baseFields()));
    expect(result.status).toBe("success");
    expect(createPrice).toHaveBeenCalledTimes(1);
    expect(createPrice.mock.calls[0][0]).toMatchObject({
      item_id: "item-1",
      price_cents: 1000,
      days_of_week: null,
      start_minute: null,
      end_minute: null,
    });
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    expect(writeAuditLog.mock.calls[0][0]).toMatchObject({
      action: "price.create",
      entity: "item_prices",
      entity_id: "new-1",
    });
    expect(writeAuditLog.mock.calls[0][0].detail).toMatchObject({ before: null });
    // The audit write runs INSIDE the same transaction client as the insert.
    expect(withTransaction).toHaveBeenCalledTimes(1);
  });

  it("valid custom-scope row with hour window → parses days + minutes", async () => {
    createPrice.mockResolvedValue(priceRow({ id: "new-2" }));
    const result = await createPriceAction(
      st,
      form(
        baseFields({
          scope: "custom",
          days: ["0", "6"],
          allHours: undefined,
          startMinute: "540",
          endMinute: "1020",
        }),
      ),
    );
    expect(result.status).toBe("success");
    expect(createPrice.mock.calls[0][0]).toMatchObject({
      days_of_week: [0, 6],
      start_minute: 540,
      end_minute: 1020,
    });
  });

  it("negative price → field error, no write", async () => {
    const result = await createPriceAction(st, form(baseFields({ price: "-1" })));
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.price).toBeDefined();
    expect(createPrice).not.toHaveBeenCalled();
  });

  it("price with 3 decimal digits → rejected, no write", async () => {
    const result = await createPriceAction(st, form(baseFields({ price: "1.005" })));
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.price).toBeDefined();
    expect(createPrice).not.toHaveBeenCalled();
  });

  it("$0.00 is accepted", async () => {
    createPrice.mockResolvedValue(priceRow({ price_cents: 0 }));
    const result = await createPriceAction(st, form(baseFields({ price: "0" })));
    expect(result.status).toBe("success");
    expect(createPrice.mock.calls[0][0].price_cents).toBe(0);
  });

  it("$12.34 parses to exactly 1234 cents (no float drift)", async () => {
    createPrice.mockResolvedValue(priceRow({ price_cents: 1234 }));
    await createPriceAction(st, form(baseFields({ price: "12.34" })));
    expect(createPrice.mock.calls[0][0].price_cents).toBe(1234);
  });

  it("day 7 (out of range) → field error, no write", async () => {
    const result = await createPriceAction(
      st,
      form(baseFields({ scope: "custom", days: ["7"], allHours: undefined , startMinute: "", endMinute: "" })),
    );
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.days).toBeDefined();
    expect(createPrice).not.toHaveBeenCalled();
  });

  it("day -1 (out of range) → field error, no write", async () => {
    const result = await createPriceAction(
      st,
      form(baseFields({ scope: "custom", days: ["-1"] })),
    );
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.days).toBeDefined();
    expect(createPrice).not.toHaveBeenCalled();
  });

  it("one-set-one-null hour window → field error, no write", async () => {
    const result = await createPriceAction(
      st,
      form(baseFields({ allHours: undefined, startMinute: "540", endMinute: "" })),
    );
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.endMinute).toBeDefined();
    expect(createPrice).not.toHaveBeenCalled();
  });

  it("out-of-bounds minute (>1440) → field error, no write", async () => {
    const result = await createPriceAction(
      st,
      form(baseFields({ allHours: undefined, startMinute: "0", endMinute: "1441" })),
    );
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.endMinute).toBeDefined();
    expect(createPrice).not.toHaveBeenCalled();
  });

  it("end == start → field error, no write", async () => {
    const result = await createPriceAction(
      st,
      form(baseFields({ allHours: undefined, startMinute: "540", endMinute: "540" })),
    );
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.endMinute).toBeDefined();
    expect(createPrice).not.toHaveBeenCalled();
  });

  it("end < start (inverted) → field error, no write", async () => {
    const result = await createPriceAction(
      st,
      form(baseFields({ allHours: undefined, startMinute: "600", endMinute: "540" })),
    );
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.endMinute).toBeDefined();
    expect(createPrice).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// updatePriceAction
// ---------------------------------------------------------------------------
describe("updatePriceAction", () => {
  it("valid edit of a non-base row → updatePrice + audit(price.update), success", async () => {
    getPriceById.mockResolvedValue(priceRow({ id: "price-2", item_id: "item-1", days_of_week: [1, 2] }));
    listPricesForItem.mockResolvedValue([
      priceRow({ id: "price-1" }), // base row still present
      priceRow({ id: "price-2", item_id: "item-1", days_of_week: [1, 2] }),
    ]);
    updatePrice.mockResolvedValue(priceRow({ id: "price-2", price_cents: 1500, days_of_week: [1, 2] }));

    const result = await updatePriceAction(
      st,
      form({ id: "price-2", ...baseFields({ scope: "custom", days: ["1", "2"], price: "15.00" }) }),
    );
    expect(result.status).toBe("success");
    expect(updatePrice).toHaveBeenCalledWith(
      "price-2",
      expect.objectContaining({ price_cents: 1500, days_of_week: [1, 2] }),
      expect.anything(),
    );
    expect(writeAuditLog.mock.calls[0][0]).toMatchObject({
      action: "price.update",
      entity: "item_prices",
      entity_id: "price-2",
    });
  });

  it("editing the only base row into a scoped override → warning, no write", async () => {
    const baseOnly = priceRow({ id: "price-1", item_id: "item-1" }); // all-days/all-hours
    getPriceById.mockResolvedValue(baseOnly);
    listPricesForItem.mockResolvedValue([baseOnly]);

    const result = await updatePriceAction(
      st,
      form({
        id: "price-1",
        ...baseFields({ scope: "custom", days: ["1"], allHours: undefined }),
      }),
    );
    expect(result.status).toBe("warning");
    expect(result.priceId).toBe("price-1");
    expect(updatePrice).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("re-submitting the same edit with confirmed=true proceeds", async () => {
    const baseOnly = priceRow({ id: "price-1", item_id: "item-1" });
    getPriceById.mockResolvedValue(baseOnly);
    listPricesForItem.mockResolvedValue([baseOnly]);
    updatePrice.mockResolvedValue(
      priceRow({ id: "price-1", item_id: "item-1", days_of_week: [1] }),
    );

    const result = await updatePriceAction(
      st,
      form({
        id: "price-1",
        confirmed: "true",
        ...baseFields({ scope: "custom", days: ["1"], allHours: undefined }),
      }),
    );
    expect(result.status).toBe("success");
    expect(updatePrice).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    // confirmed=true skips the re-check entirely — listPricesForItem isn't
    // needed to decide, though the mock above still stands in if called.
  });

  it("editing a non-base row never triggers the base-row warning even without confirmed", async () => {
    const baseRowPresent = priceRow({ id: "price-1", item_id: "item-1" });
    const target = priceRow({ id: "price-2", item_id: "item-1", days_of_week: [3] });
    getPriceById.mockResolvedValue(target);
    listPricesForItem.mockResolvedValue([baseRowPresent, target]);
    updatePrice.mockResolvedValue(priceRow({ id: "price-2", item_id: "item-1", days_of_week: [4] }));

    const result = await updatePriceAction(
      st,
      form({ id: "price-2", ...baseFields({ scope: "custom", days: ["4"] }) }),
    );
    expect(result.status).toBe("success");
    expect(updatePrice).toHaveBeenCalled();
  });

  it("unknown price id → error, no write", async () => {
    getPriceById.mockResolvedValue(null);
    const result = await updatePriceAction(st, form({ id: "ghost", ...baseFields() }));
    expect(result.status).toBe("error");
    expect(updatePrice).not.toHaveBeenCalled();
  });

  it("missing id → error, no DB work", async () => {
    const result = await updatePriceAction(st, form({ id: "", ...baseFields() }));
    expect(result.status).toBe("error");
    expect(getPriceById).not.toHaveBeenCalled();
    expect(updatePrice).not.toHaveBeenCalled();
  });

  it("invalid price on edit → field error, no write", async () => {
    const result = await updatePriceAction(
      st,
      form({ id: "price-1", ...baseFields({ price: "abc" }) }),
    );
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.price).toBeDefined();
    expect(getPriceById).not.toHaveBeenCalled();
    expect(updatePrice).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deletePriceAction
// ---------------------------------------------------------------------------
describe("deletePriceAction", () => {
  it("deleting a non-base row → deletePrice + audit(price.delete), success", async () => {
    const baseRowPresent = priceRow({ id: "price-1", item_id: "item-1" });
    const target = priceRow({ id: "price-2", item_id: "item-1", days_of_week: [5] });
    getPriceById.mockResolvedValue(target);
    listPricesForItem.mockResolvedValue([baseRowPresent, target]);
    deletePrice.mockResolvedValue(true);

    const result = await deletePriceAction(st, form({ id: "price-2", itemId: "item-1" }));
    expect(result.status).toBe("success");
    expect(deletePrice).toHaveBeenCalledWith("price-2", expect.anything());
    expect(writeAuditLog.mock.calls[0][0]).toMatchObject({
      action: "price.delete",
      entity: "item_prices",
      entity_id: "price-2",
    });
    expect(writeAuditLog.mock.calls[0][0].detail).toMatchObject({ after: null });
  });

  it("deleting the only base row → warning, no write", async () => {
    const baseOnly = priceRow({ id: "price-1", item_id: "item-1" });
    getPriceById.mockResolvedValue(baseOnly);
    listPricesForItem.mockResolvedValue([baseOnly]);

    const result = await deletePriceAction(st, form({ id: "price-1", itemId: "item-1" }));
    expect(result.status).toBe("warning");
    expect(result.priceId).toBe("price-1");
    expect(deletePrice).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("re-submitting the delete with confirmed=true proceeds", async () => {
    const baseOnly = priceRow({ id: "price-1", item_id: "item-1" });
    getPriceById.mockResolvedValue(baseOnly);
    listPricesForItem.mockResolvedValue([baseOnly]);
    deletePrice.mockResolvedValue(true);

    const result = await deletePriceAction(
      st,
      form({ id: "price-1", itemId: "item-1", confirmed: "true" }),
    );
    expect(result.status).toBe("success");
    expect(deletePrice).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
  });

  it("deleting when another base row still exists never warns", async () => {
    const baseA = priceRow({ id: "price-1", item_id: "item-1" });
    const baseB = priceRow({ id: "price-3", item_id: "item-1" });
    getPriceById.mockResolvedValue(baseA);
    listPricesForItem.mockResolvedValue([baseA, baseB]);
    deletePrice.mockResolvedValue(true);

    const result = await deletePriceAction(st, form({ id: "price-1", itemId: "item-1" }));
    expect(result.status).toBe("success");
    expect(deletePrice).toHaveBeenCalled();
  });

  it("unknown price id → error, no write", async () => {
    getPriceById.mockResolvedValue(null);
    const result = await deletePriceAction(st, form({ id: "ghost", itemId: "item-1" }));
    expect(result.status).toBe("error");
    expect(deletePrice).not.toHaveBeenCalled();
  });

  it("missing id/itemId → error, no DB work", async () => {
    const result = await deletePriceAction(st, form({ id: "", itemId: "" }));
    expect(result.status).toBe("error");
    expect(getPriceById).not.toHaveBeenCalled();
    expect(deletePrice).not.toHaveBeenCalled();
  });

  it("item_id mismatch (row doesn't belong to the given item) → error, no write", async () => {
    getPriceById.mockResolvedValue(priceRow({ id: "price-1", item_id: "other-item" }));
    const result = await deletePriceAction(st, form({ id: "price-1", itemId: "item-1" }));
    expect(result.status).toBe("error");
    expect(deletePrice).not.toHaveBeenCalled();
  });
});
