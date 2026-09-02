"use server";
import "server-only";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/guards";
import { withTransaction } from "@/lib/db";
import { writeAuditLog } from "@/lib/repositories/audit-log";
import {
  createCategory,
  deleteCategory,
  getCategoryById,
  getCategoryBySlug,
  updateCategory,
} from "@/lib/repositories/categories";
import {
  assignItemToCategory,
  listCategoriesForItem,
  listItemsForCategory,
  removeItemFromCategory,
  setItemCategories,
} from "@/lib/repositories/item-categories";
import {
  assignSchema,
  categoryCreateSchema,
  categoryIdSchema,
  categoryUpdateSchema,
  fieldErrorsFrom,
  setMembershipSchema,
} from "./validation";
import type { CategoriesActionState } from "./state";

// Categories admin server actions (execution-plan P6.5, spec §4/§6). Every
// action is ADMIN-ONLY — requireAdmin() runs FIRST, before any parsing or DB
// work, so authorization is enforced on the server and never on hidden UI
// (mirrors app/users/actions.ts, P6.6).
//
// Each mutation + its admin_audit_log row (CLAUDE.md: audit EVERY mutation) run
// inside ONE withTransaction so they commit atomically. `categories` has no
// `active` column and its `item_categories` FKs are ON DELETE CASCADE, so
// deleteCategory() is a legitimate hard delete here (unlike items/reservations,
// which carry history) — but it silently drops assignment rows, so the delete
// flow requires an explicit confirmed=true re-submit once assigned products
// exist, and records the dropped item ids in the audit detail.before.
//
// Result state (shape consumed by useActionState in the client form) lives in
// ./state — a "use server" file may only export async functions.

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

// ---------------------------------------------------------------------------
// Create category
// ---------------------------------------------------------------------------

export async function createCategoryAction(
  _prevState: CategoriesActionState,
  formData: FormData,
): Promise<CategoriesActionState> {
  const admin = await requireAdmin();

  const parsed = categoryCreateSchema.safeParse({
    slug: formData.get("slug") ?? "",
    name: formData.get("name") ?? "",
    sort_order: formData.get("sort_order") ?? "0",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }
  const { slug, name, sort_order } = parsed.data;

  const existing = await getCategoryBySlug(slug);
  if (existing) {
    return {
      status: "error",
      message: "That slug is already in use.",
      fieldErrors: { slug: "Already in use — choose a different slug." },
    };
  }

  try {
    await withTransaction(async (client) => {
      const created = await createCategory({ slug, name, sort_order }, client);
      await writeAuditLog(
        {
          actor_uid: admin.uid,
          actor_email: admin.email,
          action: "category.create",
          entity: "categories",
          entity_id: created.id,
          detail: {
            before: null,
            after: { slug: created.slug, name: created.name, sort_order: created.sort_order },
          },
        },
        client,
      );
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return {
        status: "error",
        message: "That slug is already in use.",
        fieldErrors: { slug: "Already in use — choose a different slug." },
      };
    }
    return { status: "error", message: "Could not create the category. Please try again." };
  }

  revalidatePath("/categories");
  return { status: "success", message: `Created category "${name}".` };
}

// ---------------------------------------------------------------------------
// Update category (slug, name, sort_order)
// ---------------------------------------------------------------------------

export async function updateCategoryAction(
  _prevState: CategoriesActionState,
  formData: FormData,
): Promise<CategoriesActionState> {
  const admin = await requireAdmin();

  const parsed = categoryUpdateSchema.safeParse({
    id: formData.get("id") ?? "",
    slug: formData.get("slug") ?? "",
    name: formData.get("name") ?? "",
    sort_order: formData.get("sort_order") ?? "0",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }
  const { id, slug, name, sort_order } = parsed.data;

  const existing = await getCategoryById(id);
  if (!existing) {
    return { status: "error", message: "Category not found." };
  }

  // A category keeping its own slug is fine; any other category owning that
  // slug is a conflict.
  const bySlug = await getCategoryBySlug(slug);
  if (bySlug && bySlug.id !== id) {
    return {
      status: "error",
      message: "That slug is already in use.",
      fieldErrors: { slug: "Already in use — choose a different slug." },
    };
  }

  try {
    await withTransaction(async (client) => {
      const updated = await updateCategory(id, { slug, name, sort_order }, client);
      if (!updated) throw new Error("category not found");
      await writeAuditLog(
        {
          actor_uid: admin.uid,
          actor_email: admin.email,
          action: "category.update",
          entity: "categories",
          entity_id: id,
          detail: {
            before: { slug: existing.slug, name: existing.name, sort_order: existing.sort_order },
            after: { slug: updated.slug, name: updated.name, sort_order: updated.sort_order },
          },
        },
        client,
      );
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return {
        status: "error",
        message: "That slug is already in use.",
        fieldErrors: { slug: "Already in use — choose a different slug." },
      };
    }
    return { status: "error", message: "Could not update the category. Please try again." };
  }

  revalidatePath("/categories");
  return { status: "success", message: `Updated category "${name}".` };
}

// ---------------------------------------------------------------------------
// Delete category — requires explicit confirm once products are assigned
// ---------------------------------------------------------------------------

export async function deleteCategoryAction(
  _prevState: CategoriesActionState,
  formData: FormData,
): Promise<CategoriesActionState> {
  const admin = await requireAdmin();

  const parsedId = categoryIdSchema.safeParse(formData.get("id") ?? "");
  if (!parsedId.success) {
    return { status: "error", message: "Missing category id." };
  }
  const id = parsedId.data;
  const confirmed = formData.get("confirmed") === "true";

  const existing = await getCategoryById(id);
  if (!existing) {
    return { status: "error", message: "Category not found." };
  }

  const assignedItems = await listItemsForCategory(id);

  if (assignedItems.length > 0 && !confirmed) {
    const count = assignedItems.length;
    return {
      status: "confirm",
      message: `"${existing.name}" is assigned to ${count} product${count === 1 ? "" : "s"}. Deleting it will remove ${count === 1 ? "that assignment" : "those assignments"}. Delete anyway?`,
      confirmCategoryId: id,
    };
  }

  try {
    await withTransaction(async (client) => {
      const removed = await deleteCategory(id, client);
      if (!removed) throw new Error("category not found");
      await writeAuditLog(
        {
          actor_uid: admin.uid,
          actor_email: admin.email,
          action: "category.delete",
          entity: "categories",
          entity_id: id,
          detail: {
            before: {
              slug: existing.slug,
              name: existing.name,
              sort_order: existing.sort_order,
              assignedItemIds: assignedItems.map((i) => i.id),
            },
            after: null,
          },
        },
        client,
      );
    });
  } catch {
    return { status: "error", message: "Could not delete the category. Please try again." };
  }

  revalidatePath("/categories");
  return { status: "success", message: `Deleted category "${existing.name}".` };
}

// ---------------------------------------------------------------------------
// Assign / unassign a single (item, category) pair
// ---------------------------------------------------------------------------

export async function assignItemAction(
  _prevState: CategoriesActionState,
  formData: FormData,
): Promise<CategoriesActionState> {
  const admin = await requireAdmin();

  const parsed = assignSchema.safeParse({
    itemId: formData.get("itemId") ?? "",
    categoryId: formData.get("categoryId") ?? "",
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid assignment request." };
  }
  const { itemId, categoryId } = parsed.data;

  try {
    await withTransaction(async (client) => {
      // Idempotent (ON CONFLICT DO NOTHING) — re-assigning an already-assigned
      // item is a no-op, not an error.
      await assignItemToCategory(itemId, categoryId, client);
      await writeAuditLog(
        {
          actor_uid: admin.uid,
          actor_email: admin.email,
          action: "item_category.assign",
          entity: "item_categories",
          entity_id: itemId,
          detail: { before: null, after: { categoryId } },
        },
        client,
      );
    });
  } catch {
    return { status: "error", message: "Could not assign the product. Please try again." };
  }

  revalidatePath("/categories");
  return { status: "success", message: "Product assigned." };
}

export async function unassignItemAction(
  _prevState: CategoriesActionState,
  formData: FormData,
): Promise<CategoriesActionState> {
  const admin = await requireAdmin();

  const parsed = assignSchema.safeParse({
    itemId: formData.get("itemId") ?? "",
    categoryId: formData.get("categoryId") ?? "",
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid assignment request." };
  }
  const { itemId, categoryId } = parsed.data;

  try {
    await withTransaction(async (client) => {
      await removeItemFromCategory(itemId, categoryId, client);
      await writeAuditLog(
        {
          actor_uid: admin.uid,
          actor_email: admin.email,
          action: "item_category.unassign",
          entity: "item_categories",
          entity_id: itemId,
          detail: { before: { categoryId }, after: null },
        },
        client,
      );
    });
  } catch {
    return { status: "error", message: "Could not unassign the product. Please try again." };
  }

  revalidatePath("/categories");
  return { status: "success", message: "Product unassigned." };
}

// ---------------------------------------------------------------------------
// Bulk: set the full category membership for one item
// ---------------------------------------------------------------------------

export async function setItemCategoriesAction(
  _prevState: CategoriesActionState,
  formData: FormData,
): Promise<CategoriesActionState> {
  const admin = await requireAdmin();

  const parsed = setMembershipSchema.safeParse({
    itemId: formData.get("itemId") ?? "",
    categoryIds: formData.getAll("categoryIds").map(String),
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid category assignment request." };
  }
  const { itemId, categoryIds } = parsed.data;

  const before = await listCategoriesForItem(itemId);

  try {
    await withTransaction(async (client) => {
      // setItemCategories runs a DELETE + INSERT — MUST share this transaction
      // client so the replace is atomic (see its docstring in item-categories.ts).
      await setItemCategories(itemId, categoryIds, client);
      await writeAuditLog(
        {
          actor_uid: admin.uid,
          actor_email: admin.email,
          action: "item_category.set",
          entity: "item_categories",
          entity_id: itemId,
          detail: {
            before: before.map((c) => c.id),
            after: categoryIds,
          },
        },
        client,
      );
    });
  } catch {
    return { status: "error", message: "Could not update category assignments. Please try again." };
  }

  revalidatePath("/categories");
  return { status: "success", message: "Category assignments updated." };
}
