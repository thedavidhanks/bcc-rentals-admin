import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CategoryRow, ItemRow } from "../lib/repositories/types";

// P6.5 — categories server-action tests (app/categories/actions.ts). Mirrors
// tests/users-actions.test.ts: mock the guard, withTransaction, the repo fns,
// writeAuditLog + next/cache, drive each action with FormData, and assert the
// returned CategoriesActionState (or that requireAdmin's throw propagates).
//
// Everything referenced inside a vi.mock factory is created via vi.hoisted so it
// exists when the hoisted factories run.
const {
  requireAdmin,
  withTransaction,
  writeAuditLog,
  createCategory,
  updateCategory,
  deleteCategory,
  getCategoryById,
  getCategoryBySlug,
  assignItemToCategory,
  removeItemFromCategory,
  setItemCategories,
  listItemsForCategory,
  listCategoriesForItem,
  revalidatePath,
} = vi.hoisted(() => ({
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
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  getCategoryById: vi.fn(),
  getCategoryBySlug: vi.fn(),
  assignItemToCategory: vi.fn(),
  removeItemFromCategory: vi.fn(),
  setItemCategories: vi.fn(),
  listItemsForCategory: vi.fn(),
  listCategoriesForItem: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ requireAdmin }));
vi.mock("@/lib/db", () => ({ withTransaction }));
vi.mock("@/lib/repositories/audit-log", () => ({ writeAuditLog }));
vi.mock("@/lib/repositories/categories", () => ({
  createCategory,
  updateCategory,
  deleteCategory,
  getCategoryById,
  getCategoryBySlug,
}));
vi.mock("@/lib/repositories/item-categories", () => ({
  assignItemToCategory,
  removeItemFromCategory,
  setItemCategories,
  listItemsForCategory,
  listCategoriesForItem,
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  assignItemAction,
  createCategoryAction,
  deleteCategoryAction,
  setItemCategoriesAction,
  unassignItemAction,
  updateCategoryAction,
} from "@/app/categories/actions";
import { initialCategoriesActionState } from "@/app/categories/state";

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
    else fd.set(k, v);
  }
  return fd;
}

function categoryRow(over: Partial<CategoryRow> = {}): CategoryRow {
  return {
    id: "cat-1",
    slug: "room",
    name: "Room",
    sort_order: 0,
    created_at: new Date(),
    ...over,
  };
}

function itemRow(over: Partial<ItemRow> = {}): ItemRow {
  return {
    id: "item-1",
    slug: "auditorium",
    name: "Auditorium",
    type: "unique",
    total_stock: 1,
    active: true,
    short_description: null,
    long_description: null,
    highlights: null,
    image: null,
    pricing_unit: "hour",
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
  listItemsForCategory.mockResolvedValue([]);
  listCategoriesForItem.mockResolvedValue([]);
});

const st = initialCategoriesActionState;

// ---------------------------------------------------------------------------
// Authorization: requireAdmin runs FIRST for every action, before any DB work.
// ---------------------------------------------------------------------------
describe("authorization — requireAdmin throwing propagates for every action", () => {
  const cases: Array<[string, (fd: FormData) => Promise<unknown>, FormData]> = [
    [
      "createCategoryAction",
      (fd) => createCategoryAction(st, fd),
      form({ slug: "room", name: "Room", sort_order: "0" }),
    ],
    [
      "updateCategoryAction",
      (fd) => updateCategoryAction(st, fd),
      form({ id: "cat-1", slug: "room", name: "Room", sort_order: "0" }),
    ],
    ["deleteCategoryAction", (fd) => deleteCategoryAction(st, fd), form({ id: "cat-1" })],
    [
      "assignItemAction",
      (fd) => assignItemAction(st, fd),
      form({ itemId: "item-1", categoryId: "cat-1" }),
    ],
    [
      "unassignItemAction",
      (fd) => unassignItemAction(st, fd),
      form({ itemId: "item-1", categoryId: "cat-1" }),
    ],
    [
      "setItemCategoriesAction",
      (fd) => setItemCategoriesAction(st, fd),
      form({ itemId: "item-1", categoryIds: ["cat-1"] }),
    ],
  ];

  for (const [name, run, fd] of cases) {
    it(`${name} rejects when requireAdmin throws (scheduler/unauth)`, async () => {
      requireAdmin.mockRejectedValueOnce(new Error("Admin role required"));
      await expect(run(fd)).rejects.toThrow("Admin role required");
      expect(createCategory).not.toHaveBeenCalled();
      expect(updateCategory).not.toHaveBeenCalled();
      expect(deleteCategory).not.toHaveBeenCalled();
      expect(assignItemToCategory).not.toHaveBeenCalled();
      expect(removeItemFromCategory).not.toHaveBeenCalled();
      expect(setItemCategories).not.toHaveBeenCalled();
      // Not just the mutations — the read-only pre-checks (uniqueness lookups,
      // the delete-confirm assigned-items lookup, the bulk before-snapshot)
      // must ALSO never run before requireAdmin resolves. If a future edit
      // moved requireAdmin() below one of these reads, this would catch it.
      expect(getCategoryBySlug).not.toHaveBeenCalled();
      expect(getCategoryById).not.toHaveBeenCalled();
      expect(listItemsForCategory).not.toHaveBeenCalled();
      expect(listCategoriesForItem).not.toHaveBeenCalled();
      expect(withTransaction).not.toHaveBeenCalled();
      expect(writeAuditLog).not.toHaveBeenCalled();
    });
  }
});

// ---------------------------------------------------------------------------
// createCategoryAction
// ---------------------------------------------------------------------------
describe("createCategoryAction", () => {
  it("valid input, unique slug → createCategory + audit(category.create), success", async () => {
    getCategoryBySlug.mockResolvedValue(null);
    createCategory.mockResolvedValue(categoryRow({ id: "cat-new", slug: "event-add-on", name: "Event Add-On" }));
    const result = await createCategoryAction(
      st,
      form({ slug: "event-add-on", name: "Event Add-On", sort_order: "2" }),
    );
    expect(result.status).toBe("success");
    expect(createCategory).toHaveBeenCalledTimes(1);
    expect(createCategory.mock.calls[0][0]).toMatchObject({
      slug: "event-add-on",
      name: "Event Add-On",
      sort_order: 2,
    });
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    expect(writeAuditLog.mock.calls[0][0]).toMatchObject({
      action: "category.create",
      entity: "categories",
      entity_id: "cat-new",
    });
    // audit runs with the SAME transaction client as the mutation.
    expect(writeAuditLog.mock.calls[0][1]).toBeDefined();
  });

  it("rejects an unsafe slug (Zod) — no DB work", async () => {
    const result = await createCategoryAction(
      st,
      form({ slug: "Party Room", name: "Party Room", sort_order: "0" }),
    );
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.slug).toBeDefined();
    expect(getCategoryBySlug).not.toHaveBeenCalled();
    expect(createCategory).not.toHaveBeenCalled();
  });

  it("rejects a missing name — no DB work", async () => {
    const result = await createCategoryAction(st, form({ slug: "room", name: "   ", sort_order: "0" }));
    expect(result.status).toBe("error");
    expect(createCategory).not.toHaveBeenCalled();
  });

  it("duplicate slug (pre-check via getCategoryBySlug) → error, no insert", async () => {
    getCategoryBySlug.mockResolvedValue(categoryRow({ id: "cat-existing", slug: "room" }));
    const result = await createCategoryAction(st, form({ slug: "room", name: "Room", sort_order: "0" }));
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.slug).toBeDefined();
    expect(createCategory).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("DB-level unique violation (race) surfaces as a slug field error", async () => {
    getCategoryBySlug.mockResolvedValue(null);
    withTransaction.mockImplementation(async () => {
      const err = new Error("duplicate key value") as Error & { code: string };
      err.code = "23505";
      throw err;
    });
    const result = await createCategoryAction(st, form({ slug: "room", name: "Room", sort_order: "0" }));
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.slug).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// updateCategoryAction
// ---------------------------------------------------------------------------
describe("updateCategoryAction", () => {
  it("valid change → updateCategory + audit(category.update), success", async () => {
    getCategoryById.mockResolvedValue(categoryRow({ id: "cat-1", slug: "room", name: "Room", sort_order: 0 }));
    getCategoryBySlug.mockResolvedValue(null);
    updateCategory.mockResolvedValue(categoryRow({ id: "cat-1", slug: "rooms", name: "Rooms", sort_order: 1 }));
    const result = await updateCategoryAction(
      st,
      form({ id: "cat-1", slug: "rooms", name: "Rooms", sort_order: "1" }),
    );
    expect(result.status).toBe("success");
    expect(updateCategory).toHaveBeenCalledWith(
      "cat-1",
      { slug: "rooms", name: "Rooms", sort_order: 1 },
      expect.anything(),
    );
    expect(writeAuditLog.mock.calls[0][0]).toMatchObject({ action: "category.update", entity_id: "cat-1" });
  });

  it("keeping the category's own slug is allowed", async () => {
    getCategoryById.mockResolvedValue(categoryRow({ id: "cat-1", slug: "room", name: "Room", sort_order: 0 }));
    getCategoryBySlug.mockResolvedValue(categoryRow({ id: "cat-1", slug: "room" })); // same row
    updateCategory.mockResolvedValue(categoryRow({ id: "cat-1", slug: "room", name: "Room Updated", sort_order: 0 }));
    const result = await updateCategoryAction(
      st,
      form({ id: "cat-1", slug: "room", name: "Room Updated", sort_order: "0" }),
    );
    expect(result.status).toBe("success");
    expect(updateCategory).toHaveBeenCalled();
  });

  it("slug owned by a DIFFERENT category → error, no update", async () => {
    getCategoryById.mockResolvedValue(categoryRow({ id: "cat-1", slug: "room", name: "Room", sort_order: 0 }));
    getCategoryBySlug.mockResolvedValue(categoryRow({ id: "cat-2", slug: "tool" })); // owned by someone else
    const result = await updateCategoryAction(
      st,
      form({ id: "cat-1", slug: "tool", name: "Room", sort_order: "0" }),
    );
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.slug).toBeDefined();
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it("unknown category id → error, no DB work", async () => {
    getCategoryById.mockResolvedValue(null);
    const result = await updateCategoryAction(
      st,
      form({ id: "ghost", slug: "room", name: "Room", sort_order: "0" }),
    );
    expect(result.status).toBe("error");
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it("invalid slug (Zod) → error, no DB work", async () => {
    const result = await updateCategoryAction(
      st,
      form({ id: "cat-1", slug: "Bad Slug", name: "Room", sort_order: "0" }),
    );
    expect(result.status).toBe("error");
    expect(getCategoryById).not.toHaveBeenCalled();
  });

  it("DB-level unique violation (race between the pre-check and the write) surfaces as a slug field error", async () => {
    getCategoryById.mockResolvedValue(categoryRow({ id: "cat-1", slug: "room", name: "Room", sort_order: 0 }));
    getCategoryBySlug.mockResolvedValue(null); // pre-check passes...
    withTransaction.mockImplementation(async () => {
      // ...but another writer claims the slug before this transaction commits.
      const err = new Error("duplicate key value") as Error & { code: string };
      err.code = "23505";
      throw err;
    });
    const result = await updateCategoryAction(
      st,
      form({ id: "cat-1", slug: "rooms", name: "Room", sort_order: "0" }),
    );
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.slug).toBeDefined();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("category deleted concurrently (updateCategory returns null inside the tx) → generic error, no audit", async () => {
    getCategoryById.mockResolvedValue(categoryRow({ id: "cat-1", slug: "room", name: "Room", sort_order: 0 }));
    getCategoryBySlug.mockResolvedValue(null);
    updateCategory.mockResolvedValue(null);
    const result = await updateCategoryAction(
      st,
      form({ id: "cat-1", slug: "rooms", name: "Room", sort_order: "0" }),
    );
    expect(result.status).toBe("error");
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deleteCategoryAction
// ---------------------------------------------------------------------------
describe("deleteCategoryAction", () => {
  it("no assigned products → deletes immediately, audits with empty assignedItemIds", async () => {
    getCategoryById.mockResolvedValue(categoryRow({ id: "cat-1" }));
    listItemsForCategory.mockResolvedValue([]);
    deleteCategory.mockResolvedValue(true);
    const result = await deleteCategoryAction(st, form({ id: "cat-1" }));
    expect(result.status).toBe("success");
    expect(deleteCategory).toHaveBeenCalledWith("cat-1", expect.anything());
    expect(writeAuditLog.mock.calls[0][0]).toMatchObject({
      action: "category.delete",
      entity: "categories",
      entity_id: "cat-1",
    });
    const detailEmpty = writeAuditLog.mock.calls[0][0].detail as {
      before: { assignedItemIds: string[] };
    };
    expect(detailEmpty.before.assignedItemIds).toEqual([]);
  });

  it("assigned products, no confirmed=true → returns confirm state, NO delete", async () => {
    getCategoryById.mockResolvedValue(categoryRow({ id: "cat-1", name: "Room" }));
    listItemsForCategory.mockResolvedValue([itemRow({ id: "item-1" }), itemRow({ id: "item-2" })]);
    const result = await deleteCategoryAction(st, form({ id: "cat-1" }));
    expect(result.status).toBe("confirm");
    expect(result.confirmCategoryId).toBe("cat-1");
    expect(deleteCategory).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("assigned products, confirmed=true → deletes and audits assigned item ids in detail.before", async () => {
    getCategoryById.mockResolvedValue(categoryRow({ id: "cat-1", name: "Room" }));
    listItemsForCategory.mockResolvedValue([itemRow({ id: "item-1" }), itemRow({ id: "item-2" })]);
    deleteCategory.mockResolvedValue(true);
    const result = await deleteCategoryAction(st, form({ id: "cat-1", confirmed: "true" }));
    expect(result.status).toBe("success");
    expect(deleteCategory).toHaveBeenCalledWith("cat-1", expect.anything());
    const detail = writeAuditLog.mock.calls[0][0].detail as {
      before: { assignedItemIds: string[] };
      after: unknown;
    };
    expect(detail.before.assignedItemIds).toEqual(["item-1", "item-2"]);
    expect(detail.after).toBeNull();
    // audit shares the mutation's transaction client.
    expect(writeAuditLog.mock.calls[0][1]).toBeDefined();
  });

  it("unknown category id → error, no DB work", async () => {
    getCategoryById.mockResolvedValue(null);
    const result = await deleteCategoryAction(st, form({ id: "ghost" }));
    expect(result.status).toBe("error");
    expect(listItemsForCategory).not.toHaveBeenCalled();
    expect(deleteCategory).not.toHaveBeenCalled();
  });

  it("missing id → error, no DB work", async () => {
    const result = await deleteCategoryAction(st, form({ id: "" }));
    expect(result.status).toBe("error");
    expect(getCategoryById).not.toHaveBeenCalled();
  });

  it("deleted concurrently between the confirm check and the write (deleteCategory returns false) → generic error, no audit", async () => {
    getCategoryById.mockResolvedValue(categoryRow({ id: "cat-1", name: "Room" }));
    listItemsForCategory.mockResolvedValue([]);
    deleteCategory.mockResolvedValue(false);
    const result = await deleteCategoryAction(st, form({ id: "cat-1" }));
    expect(result.status).toBe("error");
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// assignItemAction / unassignItemAction
// ---------------------------------------------------------------------------
describe("assignItemAction", () => {
  it("valid pair → assignItemToCategory + audit(item_category.assign)", async () => {
    const result = await assignItemAction(st, form({ itemId: "item-1", categoryId: "cat-1" }));
    expect(result.status).toBe("success");
    expect(assignItemToCategory).toHaveBeenCalledWith("item-1", "cat-1", expect.anything());
    expect(writeAuditLog.mock.calls[0][0]).toMatchObject({
      action: "item_category.assign",
      entity: "item_categories",
      entity_id: "item-1",
    });
  });

  it("idempotent — assigning an already-assigned pair is still a success, no error", async () => {
    // assignItemToCategory is ON CONFLICT DO NOTHING in the repo; the mock
    // resolving without throwing models that no-op behavior.
    assignItemToCategory.mockResolvedValue(undefined);
    const first = await assignItemAction(st, form({ itemId: "item-1", categoryId: "cat-1" }));
    const second = await assignItemAction(st, form({ itemId: "item-1", categoryId: "cat-1" }));
    expect(first.status).toBe("success");
    expect(second.status).toBe("success");
    expect(assignItemToCategory).toHaveBeenCalledTimes(2);
  });

  it("missing itemId → error, no DB work", async () => {
    const result = await assignItemAction(st, form({ itemId: "", categoryId: "cat-1" }));
    expect(result.status).toBe("error");
    expect(assignItemToCategory).not.toHaveBeenCalled();
  });

  it("missing categoryId → error, no DB work", async () => {
    const result = await assignItemAction(st, form({ itemId: "item-1", categoryId: "" }));
    expect(result.status).toBe("error");
    expect(assignItemToCategory).not.toHaveBeenCalled();
  });
});

describe("unassignItemAction", () => {
  it("valid pair → removeItemFromCategory + audit(item_category.unassign)", async () => {
    removeItemFromCategory.mockResolvedValue(true);
    const result = await unassignItemAction(st, form({ itemId: "item-1", categoryId: "cat-1" }));
    expect(result.status).toBe("success");
    expect(removeItemFromCategory).toHaveBeenCalledWith("item-1", "cat-1", expect.anything());
    expect(writeAuditLog.mock.calls[0][0]).toMatchObject({
      action: "item_category.unassign",
      entity: "item_categories",
      entity_id: "item-1",
    });
  });

  it("missing categoryId → error, no DB work", async () => {
    const result = await unassignItemAction(st, form({ itemId: "item-1", categoryId: "" }));
    expect(result.status).toBe("error");
    expect(removeItemFromCategory).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// setItemCategoriesAction — bulk replace
// ---------------------------------------------------------------------------
describe("setItemCategoriesAction", () => {
  it("valid request → setItemCategories called WITH the transaction client + audit(item_category.set)", async () => {
    listCategoriesForItem.mockResolvedValue([categoryRow({ id: "cat-old" })]);
    const txClient = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };
    withTransaction.mockImplementation(async (fn: (client: unknown) => unknown) => fn(txClient));

    const result = await setItemCategoriesAction(
      st,
      form({ itemId: "item-1", categoryIds: ["cat-1", "cat-2"] }),
    );
    expect(result.status).toBe("success");
    expect(setItemCategories).toHaveBeenCalledWith("item-1", ["cat-1", "cat-2"], txClient);
    expect(writeAuditLog.mock.calls[0][0]).toMatchObject({
      action: "item_category.set",
      entity: "item_categories",
      entity_id: "item-1",
    });
    expect(writeAuditLog.mock.calls[0][0].detail).toMatchObject({
      before: ["cat-old"],
      after: ["cat-1", "cat-2"],
    });
    // audit shares the same transaction client as setItemCategories.
    expect(writeAuditLog.mock.calls[0][1]).toBe(txClient);
  });

  it("empty category list clears membership (allowed)", async () => {
    listCategoriesForItem.mockResolvedValue([categoryRow({ id: "cat-old" })]);
    const result = await setItemCategoriesAction(st, form({ itemId: "item-1", categoryIds: [] }));
    expect(result.status).toBe("success");
    expect(setItemCategories).toHaveBeenCalledWith("item-1", [], expect.anything());
  });

  it("missing itemId → error, no DB work", async () => {
    const result = await setItemCategoriesAction(st, form({ itemId: "", categoryIds: ["cat-1"] }));
    expect(result.status).toBe("error");
    expect(setItemCategories).not.toHaveBeenCalled();
  });

  it("a blank categoryId in the submitted list → rejected by Zod, no DB work", async () => {
    // Guards against a malformed/tampered form post (e.g. a stray empty
    // checkbox value) silently writing a bogus join row.
    const result = await setItemCategoriesAction(
      st,
      form({ itemId: "item-1", categoryIds: ["cat-1", ""] }),
    );
    expect(result.status).toBe("error");
    expect(setItemCategories).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Audit coverage: every mutating path writes exactly one audit row sharing the
// mutation's transaction client.
// ---------------------------------------------------------------------------
describe("audit-log coverage", () => {
  it("create/update/delete/assign/unassign all call writeAuditLog with the tx client", async () => {
    const txClient = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };
    withTransaction.mockImplementation(async (fn: (client: unknown) => unknown) => fn(txClient));

    getCategoryBySlug.mockResolvedValue(null);
    createCategory.mockResolvedValue(categoryRow({ id: "cat-new" }));
    await createCategoryAction(st, form({ slug: "room", name: "Room", sort_order: "0" }));
    expect(writeAuditLog).toHaveBeenLastCalledWith(expect.anything(), txClient);

    getCategoryById.mockResolvedValue(categoryRow({ id: "cat-1" }));
    updateCategory.mockResolvedValue(categoryRow({ id: "cat-1", name: "Room 2" }));
    await updateCategoryAction(st, form({ id: "cat-1", slug: "room", name: "Room 2", sort_order: "0" }));
    expect(writeAuditLog).toHaveBeenLastCalledWith(expect.anything(), txClient);

    listItemsForCategory.mockResolvedValue([]);
    deleteCategory.mockResolvedValue(true);
    await deleteCategoryAction(st, form({ id: "cat-1" }));
    expect(writeAuditLog).toHaveBeenLastCalledWith(expect.anything(), txClient);

    await assignItemAction(st, form({ itemId: "item-1", categoryId: "cat-1" }));
    expect(writeAuditLog).toHaveBeenLastCalledWith(expect.anything(), txClient);

    await unassignItemAction(st, form({ itemId: "item-1", categoryId: "cat-1" }));
    expect(writeAuditLog).toHaveBeenLastCalledWith(expect.anything(), txClient);
  });
});
