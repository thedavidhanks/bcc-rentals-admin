"use server";
import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth/guards";
import { withTransaction } from "@/lib/db";
import { writeAuditLog } from "@/lib/repositories/audit-log";
import { createItem, deactivateItem, getItemById, getItemBySlug, updateItem } from "@/lib/repositories/items";
import { createPrice } from "@/lib/repositories/item-prices";
import type { ProductsActionState } from "./state";
import { dollarsToCentsSchema, fieldErrorsFrom, itemFieldsSchema, readItemFormFields } from "./validation";

// Products admin server actions (execution-plan P6.4, spec §3/§4/§6/§7). Every
// action is ADMIN-ONLY — requireAdmin() runs FIRST, before any parsing or DB
// work, so authorization is enforced on the server and never on hidden UI.
//
// Each mutation + its audit row (CLAUDE.md: audit EVERY mutation) run inside
// ONE withTransaction so they commit atomically. Deactivate, never delete —
// there is no delete export on the items repository to reach for.
//
// The ONE seam with the P6.3 (Update Prices) agent: createProductAction calls
// the EXISTING `createPrice` export from lib/repositories/item-prices.ts (not
// owned here) to write the create form's base price as the item's first
// all-days/all-hours item_prices row, inside the same transaction client.

// Result state (shape consumed by useActionState in the client form) lives in
// ./state — a "use server" file may only export async functions.

const idSchema = z.string().trim().min(1, "Missing product id.");

/** Resolve a target item row by id, or return an error state. */
async function loadTargetById(id: string) {
  const row = await getItemById(id);
  if (!row) {
    return {
      row: null,
      error: { status: "error" as const, message: "Product not found." },
    };
  }
  return { row, error: null };
}

// ---------------------------------------------------------------------------
// Create product (+ base price)
// ---------------------------------------------------------------------------

export async function createProductAction(
  _prevState: ProductsActionState,
  formData: FormData,
): Promise<ProductsActionState> {
  const admin = await requireAdmin();

  const parsedFields = itemFieldsSchema.safeParse(readItemFormFields(formData));
  const parsedPrice = dollarsToCentsSchema.safeParse(formData.get("basePrice") ?? "");

  if (!parsedFields.success || !parsedPrice.success) {
    const fieldErrors: Record<string, string> = {};
    if (!parsedFields.success) Object.assign(fieldErrors, fieldErrorsFrom(parsedFields.error));
    if (!parsedPrice.success) {
      fieldErrors.basePrice = parsedPrice.error.issues[0]?.message ?? "Enter a valid price.";
    }
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors,
    };
  }

  const fields = parsedFields.data;
  const priceCents = parsedPrice.data;

  // Uniqueness pre-check (the DB's unique constraint is the ultimate backstop,
  // but a friendly error here avoids an unhandled insert failure).
  const conflict = await getItemBySlug(fields.slug);
  if (conflict) {
    return {
      status: "error",
      message: "That slug is already in use.",
      fieldErrors: { slug: "That slug is already in use." },
    };
  }

  try {
    const { item } = await withTransaction(async (client) => {
      const item = await createItem(
        {
          slug: fields.slug,
          name: fields.name,
          type: fields.type,
          total_stock: fields.totalStock,
          active: fields.active,
          short_description: fields.shortDescription ?? null,
          long_description: fields.longDescription ?? null,
          highlights: fields.highlights ?? null,
          image: fields.image ?? null,
          pricing_unit: fields.pricingUnit,
          min_minutes: fields.minMinutes ?? null,
          max_minutes: fields.maxMinutes ?? null,
          buffer_minutes: fields.bufferMinutes,
          lead_hours: fields.leadHours,
          horizon_days: fields.horizonDays,
          available_hours: fields.availableHours ?? null,
          sort_order: fields.sortOrder,
        },
        client,
      );

      await writeAuditLog(
        {
          actor_uid: admin.uid,
          actor_email: admin.email,
          action: "item.create",
          entity: "items",
          entity_id: item.id,
          detail: { before: null, after: item },
        },
        client,
      );

      // The base price: the item's first all-days/all-hours item_prices row
      // (spec §4/§6). Calls the P6.3-owned createPrice export — do not
      // reimplement price-row creation here.
      const price = await createPrice(
        {
          item_id: item.id,
          price_cents: priceCents,
          days_of_week: null,
          start_minute: null,
          end_minute: null,
          priority: 0,
        },
        client,
      );

      await writeAuditLog(
        {
          actor_uid: admin.uid,
          actor_email: admin.email,
          action: "price.create",
          entity: "item_prices",
          entity_id: price.id,
          detail: { before: null, after: price },
        },
        client,
      );

      return { item, price };
    });

    revalidatePath("/products");
    revalidatePath(`/products/${item.id}`);
    return { status: "success", message: `Created ${item.name}.`, itemId: item.id };
  } catch {
    return { status: "error", message: "Could not create the product. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// Update product
// ---------------------------------------------------------------------------

export async function updateProductAction(
  _prevState: ProductsActionState,
  formData: FormData,
): Promise<ProductsActionState> {
  const admin = await requireAdmin();

  const parsedId = idSchema.safeParse(formData.get("id") ?? "");
  if (!parsedId.success) {
    return { status: "error", message: "Missing product id." };
  }
  const id = parsedId.data;

  const { row: existing, error } = await loadTargetById(id);
  if (error) return error;

  const parsedFields = itemFieldsSchema.safeParse(readItemFormFields(formData));
  if (!parsedFields.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsFrom(parsedFields.error),
    };
  }
  const fields = parsedFields.data;

  // Slug uniqueness: allow keeping the item's own slug; otherwise it must be free.
  if (fields.slug !== existing.slug) {
    const conflict = await getItemBySlug(fields.slug);
    if (conflict && conflict.id !== id) {
      return {
        status: "error",
        message: "That slug is already in use.",
        fieldErrors: { slug: "That slug is already in use." },
      };
    }
  }

  try {
    const updated = await withTransaction(async (client) => {
      const updated = await updateItem(
        id,
        {
          slug: fields.slug,
          name: fields.name,
          type: fields.type,
          total_stock: fields.totalStock,
          short_description: fields.shortDescription ?? null,
          long_description: fields.longDescription ?? null,
          highlights: fields.highlights ?? null,
          image: fields.image ?? null,
          pricing_unit: fields.pricingUnit,
          min_minutes: fields.minMinutes ?? null,
          max_minutes: fields.maxMinutes ?? null,
          buffer_minutes: fields.bufferMinutes,
          lead_hours: fields.leadHours,
          horizon_days: fields.horizonDays,
          available_hours: fields.availableHours ?? null,
          sort_order: fields.sortOrder,
        },
        client,
      );
      if (!updated) throw new Error("item not found");

      await writeAuditLog(
        {
          actor_uid: admin.uid,
          actor_email: admin.email,
          action: "item.update",
          entity: "items",
          entity_id: id,
          detail: { before: existing, after: updated },
        },
        client,
      );

      return updated;
    });

    revalidatePath("/products");
    revalidatePath(`/products/${id}`);
    return { status: "success", message: `Saved ${updated.name}.`, itemId: id };
  } catch {
    return { status: "error", message: "Could not save the product. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// Activate / deactivate (deactivate, never delete)
// ---------------------------------------------------------------------------

export async function setProductActiveAction(
  _prevState: ProductsActionState,
  formData: FormData,
): Promise<ProductsActionState> {
  const admin = await requireAdmin();

  const parsedId = idSchema.safeParse(formData.get("id") ?? "");
  const activeRaw = formData.get("active");
  if (!parsedId.success || (activeRaw !== "true" && activeRaw !== "false")) {
    return { status: "error", message: "Invalid activation request." };
  }
  const id = parsedId.data;
  const active = activeRaw === "true";

  const { row: existing, error } = await loadTargetById(id);
  if (error) return error;

  try {
    await withTransaction(async (client) => {
      // Deactivate, don't delete (CLAUDE.md): reactivation goes through
      // updateItem({active:true}); deactivation goes through the dedicated
      // deactivateItem helper. Neither ever issues a DELETE.
      const updated = active
        ? await updateItem(id, { active: true }, client)
        : await deactivateItem(id, client);
      if (!updated) throw new Error("item not found");

      await writeAuditLog(
        {
          actor_uid: admin.uid,
          actor_email: admin.email,
          action: active ? "item.activate" : "item.deactivate",
          entity: "items",
          entity_id: id,
          detail: { before: { active: existing.active }, after: { active: updated.active } },
        },
        client,
      );
    });
  } catch {
    return { status: "error", message: "Could not update the product. Please try again." };
  }

  revalidatePath("/products");
  revalidatePath(`/products/${id}`);
  return {
    status: "success",
    message: active ? "Product reactivated." : "Product deactivated.",
    itemId: id,
  };
}
