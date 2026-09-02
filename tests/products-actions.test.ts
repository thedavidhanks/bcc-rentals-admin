import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ItemRow } from "../lib/repositories/types";

// P6.4 — products server-action tests (app/products/actions.ts). Mirrors
// tests/users-actions.test.ts: mock the guard, withTransaction, the repo fns,
// writeAuditLog + next/cache, drive each action with FormData, and assert the
// returned ProductsActionState (or that requireAdmin's throw propagates).
//
// Everything referenced inside a vi.mock factory is created via vi.hoisted so
// it exists when the hoisted factories run.
const {
  requireAdmin,
  withTransaction,
  writeAuditLog,
  createItem,
  updateItem,
  deactivateItem,
  getItemById,
  getItemBySlug,
  createPrice,
  revalidatePath,
} = vi.hoisted(() => {
  return {
    requireAdmin: vi.fn(async () => ({
      uid: "admin-uid",
      email: "admin@bachmancc.org",
      role: "admin" as const,
    })),
    withTransaction: vi.fn(
      async (fn: (client: unknown) => unknown) =>
        fn({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }),
    ),
    writeAuditLog: vi.fn(async (_entry: Record<string, unknown>, _client?: unknown) => ({})),
    createItem: vi.fn(),
    updateItem: vi.fn(),
    deactivateItem: vi.fn(),
    getItemById: vi.fn(),
    getItemBySlug: vi.fn(),
    createPrice: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("@/lib/auth/guards", () => ({ requireAdmin }));
vi.mock("@/lib/db", () => ({ withTransaction }));
vi.mock("@/lib/repositories/audit-log", () => ({ writeAuditLog }));
vi.mock("@/lib/repositories/items", () => ({
  createItem,
  updateItem,
  deactivateItem,
  getItemById,
  getItemBySlug,
}));
vi.mock("@/lib/repositories/item-prices", () => ({ createPrice }));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  createProductAction,
  setProductActiveAction,
  updateProductAction,
} from "@/app/products/actions";
import { initialProductsActionState } from "@/app/products/state";

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
    else fd.set(k, v);
  }
  return fd;
}

function itemRow(over: Partial<ItemRow> = {}): ItemRow {
  return {
    id: "item-1",
    slug: "party-room",
    name: "Party Room",
    type: "fungible",
    total_stock: 3,
    active: true,
    short_description: null,
    long_description: null,
    highlights: null,
    image: null,
    pricing_unit: "day",
    min_minutes: null,
    max_minutes: null,
    buffer_minutes: 0,
    lead_hours: 0,
    horizon_days: 365,
    available_hours: null,
    resource_id: null,
    sort_order: 0,
    updated_at: new Date(),
    ...over,
  };
}

function priceRow(over: Record<string, unknown> = {}) {
  return {
    id: "price-1",
    item_id: "item-1",
    price_cents: 2500,
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

// A complete, valid Add Product form payload; override individual fields as needed.
function validCreateForm(over: Record<string, string> = {}): FormData {
  return form({
    name: "Party Room",
    slug: "party-room",
    type: "fungible",
    totalStock: "3",
    active: "on",
    pricingUnit: "day",
    bufferMinutes: "0",
    leadHours: "0",
    horizonDays: "365",
    sortOrder: "0",
    basePrice: "25.00",
    ...over,
  });
}

function validEditForm(over: Record<string, string> = {}): FormData {
  return form({
    id: "item-1",
    name: "Party Room",
    slug: "party-room",
    type: "fungible",
    totalStock: "3",
    pricingUnit: "day",
    bufferMinutes: "0",
    leadHours: "0",
    horizonDays: "365",
    sortOrder: "0",
    ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockImplementation(async () => ({
    uid: "admin-uid",
    email: "admin@bachmancc.org",
    role: "admin" as const,
  }));
  withTransaction.mockImplementation(
    async (fn: (client: unknown) => unknown) =>
      fn({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }),
  );
  writeAuditLog.mockResolvedValue({});
  getItemBySlug.mockResolvedValue(null);
});

const st = initialProductsActionState;

// ---------------------------------------------------------------------------
// Authorization: requireAdmin runs FIRST for every action, before any DB work.
// ---------------------------------------------------------------------------
describe("authorization — requireAdmin throwing propagates for every action", () => {
  const cases: Array<[string, (fd: FormData) => Promise<unknown>, FormData]> = [
    ["createProductAction", (fd) => createProductAction(st, fd), validCreateForm()],
    ["updateProductAction", (fd) => updateProductAction(st, fd), validEditForm()],
    [
      "setProductActiveAction",
      (fd) => setProductActiveAction(st, fd),
      form({ id: "item-1", active: "false" }),
    ],
  ];

  for (const [name, run, fd] of cases) {
    it(`${name} rejects when requireAdmin throws (scheduler/unauth)`, async () => {
      requireAdmin.mockRejectedValueOnce(new Error("Admin role required"));
      await expect(run(fd)).rejects.toThrow("Admin role required");
      expect(createItem).not.toHaveBeenCalled();
      expect(updateItem).not.toHaveBeenCalled();
      expect(deactivateItem).not.toHaveBeenCalled();
      expect(getItemById).not.toHaveBeenCalled();
      expect(getItemBySlug).not.toHaveBeenCalled();
      expect(createPrice).not.toHaveBeenCalled();
      expect(writeAuditLog).not.toHaveBeenCalled();
    });
  }
});

// ---------------------------------------------------------------------------
// createProductAction
// ---------------------------------------------------------------------------
describe("createProductAction", () => {
  it("valid input → createItem + base price via createPrice + both audits, in the SAME tx client", async () => {
    const created = itemRow();
    createItem.mockResolvedValue(created);
    const price = priceRow();
    createPrice.mockResolvedValue(price);

    const result = await createProductAction(st, validCreateForm());

    expect(result.status).toBe("success");
    expect(result.itemId).toBe("item-1");

    expect(createItem).toHaveBeenCalledTimes(1);
    const [itemInsert, itemClient] = createItem.mock.calls[0];
    expect(itemInsert).toMatchObject({ slug: "party-room", name: "Party Room" });

    // Base price: the all-days/all-hours row, written via the P6.3-owned
    // createPrice export, with the SAME transaction client as the item insert.
    expect(createPrice).toHaveBeenCalledTimes(1);
    const [priceInsert, priceClient] = createPrice.mock.calls[0];
    expect(priceInsert).toMatchObject({
      item_id: "item-1",
      price_cents: 2500,
      days_of_week: null,
      start_minute: null,
      end_minute: null,
      priority: 0,
    });
    expect(priceClient).toBe(itemClient);

    // Two audit rows, both on the same client.
    expect(writeAuditLog).toHaveBeenCalledTimes(2);
    expect(writeAuditLog.mock.calls[0][0]).toMatchObject({
      action: "item.create",
      entity: "items",
      entity_id: "item-1",
    });
    expect(writeAuditLog.mock.calls[0][1]).toBe(itemClient);
    expect(writeAuditLog.mock.calls[1][0]).toMatchObject({
      action: "price.create",
      entity: "item_prices",
      entity_id: "price-1",
    });
    expect(writeAuditLog.mock.calls[1][1]).toBe(itemClient);
  });

  it("converts the base price to exact integer cents (no float drift)", async () => {
    createItem.mockResolvedValue(itemRow());
    createPrice.mockResolvedValue(priceRow());
    await createProductAction(st, validCreateForm({ basePrice: "19.99" }));
    expect(createPrice.mock.calls[0][0].price_cents).toBe(1999);
  });

  it("duplicate slug → error state, no insert performed", async () => {
    getItemBySlug.mockResolvedValue(itemRow({ id: "existing" }));
    const result = await createProductAction(st, validCreateForm());
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.slug).toBeDefined();
    expect(createItem).not.toHaveBeenCalled();
    expect(createPrice).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects a non-URL-safe slug, no DB work", async () => {
    const result = await createProductAction(st, validCreateForm({ slug: "Party Room" }));
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.slug).toBeDefined();
    expect(createItem).not.toHaveBeenCalled();
    expect(getItemBySlug).not.toHaveBeenCalled();
  });

  it("rejects total_stock <= 0", async () => {
    const result = await createProductAction(st, validCreateForm({ totalStock: "0" }));
    expect(result.status).toBe("error");
    expect(createItem).not.toHaveBeenCalled();
  });

  it("rejects type='unique' with total_stock > 1", async () => {
    const result = await createProductAction(
      st,
      validCreateForm({ type: "unique", totalStock: "2" }),
    );
    expect(result.status).toBe("error");
    expect(createItem).not.toHaveBeenCalled();
  });

  it("rejects negative buffer_minutes / lead_hours", async () => {
    const r1 = await createProductAction(st, validCreateForm({ bufferMinutes: "-1" }));
    expect(r1.status).toBe("error");
    const r2 = await createProductAction(st, validCreateForm({ leadHours: "-1" }));
    expect(r2.status).toBe("error");
    expect(createItem).not.toHaveBeenCalled();
  });

  it("rejects horizon_days <= 0", async () => {
    const result = await createProductAction(st, validCreateForm({ horizonDays: "0" }));
    expect(result.status).toBe("error");
    expect(createItem).not.toHaveBeenCalled();
  });

  it("rejects max_minutes < min_minutes", async () => {
    const result = await createProductAction(
      st,
      validCreateForm({ minMinutes: "120", maxMinutes: "60" }),
    );
    expect(result.status).toBe("error");
    expect(createItem).not.toHaveBeenCalled();
  });

  it("rejects a malformed available_hours trio", async () => {
    const result = await createProductAction(
      st,
      validCreateForm({
        availableHoursEnabled: "on",
        availableHoursOpen: "8",
        // closeHour missing
        availableHoursSlot: "30",
      }),
    );
    expect(result.status).toBe("error");
    expect(createItem).not.toHaveBeenCalled();
  });

  it("rejects an invalid base price and does not write anything", async () => {
    const result = await createProductAction(st, validCreateForm({ basePrice: "not-money" }));
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.basePrice).toBeDefined();
    expect(createItem).not.toHaveBeenCalled();
    expect(createPrice).not.toHaveBeenCalled();
  });

  it("DB failure inside the transaction → error state, no partial success reported", async () => {
    createItem.mockResolvedValue(itemRow());
    createPrice.mockRejectedValue(new Error("db exploded"));
    const result = await createProductAction(st, validCreateForm());
    expect(result.status).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// updateProductAction
// ---------------------------------------------------------------------------
describe("updateProductAction", () => {
  it("valid edit → updateItem + audit(item.update), success", async () => {
    getItemById.mockResolvedValue(itemRow());
    updateItem.mockResolvedValue(itemRow({ name: "Party Room (renamed)" }));

    const result = await updateProductAction(st, validEditForm({ name: "Party Room (renamed)" }));

    expect(result.status).toBe("success");
    expect(updateItem).toHaveBeenCalledTimes(1);
    expect(updateItem.mock.calls[0][0]).toBe("item-1");
    expect(updateItem.mock.calls[0][1]).toMatchObject({ name: "Party Room (renamed)" });
    expect(writeAuditLog.mock.calls[0][0]).toMatchObject({
      action: "item.update",
      entity: "items",
      entity_id: "item-1",
    });
    // No price mutation on edit — that's P6.3's job.
    expect(createPrice).not.toHaveBeenCalled();
  });

  it("keeping the item's own slug is allowed (no uniqueness conflict)", async () => {
    getItemById.mockResolvedValue(itemRow({ slug: "party-room" }));
    updateItem.mockResolvedValue(itemRow({ slug: "party-room" }));
    const result = await updateProductAction(st, validEditForm({ slug: "party-room" }));
    expect(result.status).toBe("success");
    // Same slug as the existing row → no need to consult getItemBySlug.
    expect(getItemBySlug).not.toHaveBeenCalled();
  });

  it("changing to a slug already used by another item → error, no update", async () => {
    getItemById.mockResolvedValue(itemRow({ id: "item-1", slug: "party-room" }));
    getItemBySlug.mockResolvedValue(itemRow({ id: "item-2", slug: "new-slug" }));
    const result = await updateProductAction(st, validEditForm({ slug: "new-slug" }));
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.slug).toBeDefined();
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("changing to a slug that resolves back to the same item is allowed", async () => {
    getItemById.mockResolvedValue(itemRow({ id: "item-1", slug: "party-room" }));
    getItemBySlug.mockResolvedValue(itemRow({ id: "item-1", slug: "renamed-slug" }));
    updateItem.mockResolvedValue(itemRow({ id: "item-1", slug: "renamed-slug" }));
    const result = await updateProductAction(st, validEditForm({ slug: "renamed-slug" }));
    expect(result.status).toBe("success");
    expect(updateItem).toHaveBeenCalled();
  });

  it("unknown id → 'Product not found.', no update", async () => {
    getItemById.mockResolvedValue(null);
    const result = await updateProductAction(st, validEditForm({ id: "ghost" }));
    expect(result.status).toBe("error");
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("missing id → error, no lookups", async () => {
    const result = await updateProductAction(st, validEditForm({ id: "" }));
    expect(result.status).toBe("error");
    expect(getItemById).not.toHaveBeenCalled();
  });

  it("rejects total_stock <= 0 on edit", async () => {
    getItemById.mockResolvedValue(itemRow());
    const result = await updateProductAction(st, validEditForm({ totalStock: "-3" }));
    expect(result.status).toBe("error");
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("rejects max_minutes < min_minutes on edit", async () => {
    getItemById.mockResolvedValue(itemRow());
    const result = await updateProductAction(
      st,
      validEditForm({ minMinutes: "100", maxMinutes: "10" }),
    );
    expect(result.status).toBe("error");
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("audit detail carries before (existing row) and after (updated row)", async () => {
    const existing = itemRow({ name: "Old Name" });
    const updated = itemRow({ name: "New Name" });
    getItemById.mockResolvedValue(existing);
    updateItem.mockResolvedValue(updated);
    await updateProductAction(st, validEditForm({ name: "New Name" }));
    expect(writeAuditLog.mock.calls[0][0].detail).toMatchObject({
      before: existing,
      after: updated,
    });
  });
});

// ---------------------------------------------------------------------------
// setProductActiveAction — deactivate-not-delete
// ---------------------------------------------------------------------------
describe("setProductActiveAction", () => {
  it("deactivate → deactivateItem (never a delete) + audit(item.deactivate)", async () => {
    getItemById.mockResolvedValue(itemRow({ active: true }));
    deactivateItem.mockResolvedValue(itemRow({ active: false }));

    const result = await setProductActiveAction(st, form({ id: "item-1", active: "false" }));

    expect(result.status).toBe("success");
    expect(deactivateItem).toHaveBeenCalledWith("item-1", expect.anything());
    expect(writeAuditLog.mock.calls[0][0]).toMatchObject({ action: "item.deactivate" });
    // No delete-shaped call exists anywhere on the items repository mock.
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("reactivate → updateItem({active:true}) + audit(item.activate)", async () => {
    getItemById.mockResolvedValue(itemRow({ active: false }));
    updateItem.mockResolvedValue(itemRow({ active: true }));

    const result = await setProductActiveAction(st, form({ id: "item-1", active: "true" }));

    expect(result.status).toBe("success");
    expect(updateItem).toHaveBeenCalledWith("item-1", { active: true }, expect.anything());
    expect(writeAuditLog.mock.calls[0][0]).toMatchObject({ action: "item.activate" });
    expect(deactivateItem).not.toHaveBeenCalled();
  });

  it("unknown id → 'Product not found.', no mutation", async () => {
    getItemById.mockResolvedValue(null);
    const result = await setProductActiveAction(st, form({ id: "ghost", active: "false" }));
    expect(result.status).toBe("error");
    expect(deactivateItem).not.toHaveBeenCalled();
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("invalid active value → error, no DB work", async () => {
    const result = await setProductActiveAction(st, form({ id: "item-1", active: "maybe" }));
    expect(result.status).toBe("error");
    expect(getItemById).not.toHaveBeenCalled();
  });

  it("missing id → error, no DB work", async () => {
    const result = await setProductActiveAction(st, form({ id: "", active: "false" }));
    expect(result.status).toBe("error");
    expect(getItemById).not.toHaveBeenCalled();
  });
});
