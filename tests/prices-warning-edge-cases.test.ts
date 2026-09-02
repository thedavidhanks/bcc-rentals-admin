import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ItemPriceRow } from "../lib/repositories/types";

// P6.3 — supplemental stress tests for app/prices/actions.ts, verifying:
//   1. The warning path performs ZERO transaction/DB-write activity (not just
//      that createPrice/updatePrice/deletePrice/writeAuditLog weren't called,
//      but that withTransaction itself is never entered).
//   2. The audit-log write for update/delete is passed the SAME transaction
//      client object as the mutation call (single atomic transaction, not two).
//   3. A row that's currently the (duplicate) base row, when another base row
//      already exists, can be edited away from base without warning — driven
//      through the action, not just the pure helper.
//   4. Empty days[] with scope=custom is rejected by the action end-to-end.
//   5. Duplicate day entries are rejected by the action end-to-end.
//
// Mirrors tests/prices-actions.test.ts's mocking setup exactly.

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
// The warning path enters NO transaction at all (not just "no mutation call")
// ---------------------------------------------------------------------------
describe("warning path never opens a transaction", () => {
  it("updatePriceAction: editing the only base row into a scoped override never calls withTransaction", async () => {
    const baseOnly = priceRow({ id: "price-1", item_id: "item-1" });
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
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("deletePriceAction: deleting the only base row never calls withTransaction", async () => {
    const baseOnly = priceRow({ id: "price-1", item_id: "item-1" });
    getPriceById.mockResolvedValue(baseOnly);
    listPricesForItem.mockResolvedValue([baseOnly]);

    const result = await deletePriceAction(st, form({ id: "price-1", itemId: "item-1" }));
    expect(result.status).toBe("warning");
    expect(withTransaction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The mutation + its audit-log row share the SAME transaction client object
// ---------------------------------------------------------------------------
describe("mutation and audit-log write share the same transaction client", () => {
  it("createPriceAction passes the identical client to createPrice and writeAuditLog", async () => {
    createPrice.mockResolvedValue(priceRow({ id: "new-1" }));
    await createPriceAction(st, form(baseFields()));

    expect(createPrice).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    const clientPassedToCreate = createPrice.mock.calls[0][1];
    const clientPassedToAudit = writeAuditLog.mock.calls[0][1];
    expect(clientPassedToCreate).toBeDefined();
    expect(clientPassedToCreate).toBe(clientPassedToAudit);
  });

  it("updatePriceAction passes the identical client to updatePrice and writeAuditLog", async () => {
    const nonBase = priceRow({ id: "price-2", item_id: "item-1", days_of_week: [1, 2] });
    getPriceById.mockResolvedValue(nonBase);
    listPricesForItem.mockResolvedValue([priceRow({ id: "price-1" }), nonBase]);
    updatePrice.mockResolvedValue(priceRow({ id: "price-2", days_of_week: [3] }));

    await updatePriceAction(
      st,
      form({ id: "price-2", ...baseFields({ scope: "custom", days: ["3"] }) }),
    );

    expect(updatePrice).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    const clientPassedToUpdate = updatePrice.mock.calls[0][2];
    const clientPassedToAudit = writeAuditLog.mock.calls[0][1];
    expect(clientPassedToUpdate).toBeDefined();
    expect(clientPassedToUpdate).toBe(clientPassedToAudit);
  });

  it("deletePriceAction passes the identical client to deletePrice and writeAuditLog", async () => {
    const nonBase = priceRow({ id: "price-2", item_id: "item-1", days_of_week: [5] });
    getPriceById.mockResolvedValue(nonBase);
    listPricesForItem.mockResolvedValue([priceRow({ id: "price-1" }), nonBase]);
    deletePrice.mockResolvedValue(true);

    await deletePriceAction(st, form({ id: "price-2", itemId: "item-1" }));

    expect(deletePrice).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    const clientPassedToDelete = deletePrice.mock.calls[0][1];
    const clientPassedToAudit = writeAuditLog.mock.calls[0][1];
    expect(clientPassedToDelete).toBeDefined();
    expect(clientPassedToDelete).toBe(clientPassedToAudit);
  });
});

// ---------------------------------------------------------------------------
// Duplicate base row: editing the currently-base row away from base when
// ANOTHER row is already a base row must never warn (driven through the
// action, not just the pure helper already covered in price-validation.test.ts).
// ---------------------------------------------------------------------------
describe("duplicate base row via the action", () => {
  it("updatePriceAction: editing one of two base rows into a scoped override does not warn", async () => {
    const baseA = priceRow({ id: "price-1", item_id: "item-1" });
    const baseB = priceRow({ id: "price-2", item_id: "item-1" });
    getPriceById.mockResolvedValue(baseA);
    listPricesForItem.mockResolvedValue([baseA, baseB]);
    updatePrice.mockResolvedValue(
      priceRow({ id: "price-1", item_id: "item-1", days_of_week: [1] }),
    );

    const result = await updatePriceAction(
      st,
      form({
        id: "price-1",
        ...baseFields({ scope: "custom", days: ["1"], allHours: undefined }),
      }),
    );
    expect(result.status).toBe("success");
    expect(updatePrice).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// days_of_week edge cases driven end-to-end through createPriceAction
// ---------------------------------------------------------------------------
describe("days_of_week edge cases via the action", () => {
  it("empty days[] with scope=custom → field error, no write", async () => {
    const result = await createPriceAction(
      st,
      form(baseFields({ scope: "custom", days: [], allHours: undefined, startMinute: "", endMinute: "" })),
    );
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.days).toBeDefined();
    expect(createPrice).not.toHaveBeenCalled();
  });

  it("duplicate day entries → field error, no write", async () => {
    const result = await createPriceAction(
      st,
      form(baseFields({ scope: "custom", days: ["1", "1"] })),
    );
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.days).toBeDefined();
    expect(createPrice).not.toHaveBeenCalled();
  });

  it("full-day window 0..1440 is accepted (boundary values, not off-by-one rejected)", async () => {
    createPrice.mockResolvedValue(priceRow({ start_minute: 0, end_minute: 1440 }));
    const result = await createPriceAction(
      st,
      form(baseFields({ allHours: undefined, startMinute: "0", endMinute: "1440" })),
    );
    expect(result.status).toBe("success");
    expect(createPrice.mock.calls[0][0]).toMatchObject({ start_minute: 0, end_minute: 1440 });
  });
});
