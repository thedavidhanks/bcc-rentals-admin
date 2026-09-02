"use server";
import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireScheduler } from "@/lib/auth/guards";
import { withTransaction } from "@/lib/db";
import { writeAuditLog } from "@/lib/repositories/audit-log";
import {
  createPrice,
  deletePrice,
  getPriceById,
  listPricesForItem,
  updatePrice,
} from "@/lib/repositories/item-prices";
import type { ItemPriceRow } from "@/lib/repositories/types";
import {
  parseDollarsToCents,
  validateDaysOfWeek,
  validateHourWindow,
  wouldRemoveBaseRowOnDelete,
  wouldRemoveBaseRowOnUpdate,
  type PriceScope,
} from "./pricing";
import type { PriceActionState } from "./state";

// Update Prices server actions (execution-plan P6.3, spec §4/§6/§7). Every
// action is SCHEDULER-OR-ADMIN — requireScheduler() runs FIRST, before any
// parsing or DB work, so authorization is enforced on the server and never on
// hidden UI (schedulers AND admins may manage prices per the spec §1 matrix).
//
// Each mutation + its admin_audit_log row (CLAUDE.md: audit EVERY mutation)
// run inside ONE withTransaction so they commit atomically. Money is parsed
// from the dollars STRING into integer cents (no floats, no
// Math.round(parseFloat(...)) drift — see app/prices/pricing.ts).
//
// Base-row warning (spec §6/§7): an update/delete that would leave the item
// with no all-days/all-hours row does NOT silently fail. It returns
// `status: "warning"` with `priceId` identifying the affected row and performs
// NO write. The client form resubmits the identical FormData with a hidden
// `confirmed=true`, and the action then proceeds.
//
// Result-state shape lives in ./state — a "use server" file may only export
// async functions (Next.js runtime-validates every export).

// ---------------------------------------------------------------------------
// Zod: scalar field parsing. The day-set / hour-window cross-field rules live
// in the pure helpers (./pricing) so they're covered directly by
// tests/price-validation.test.ts as well as through the actions.
// ---------------------------------------------------------------------------

const idSchema = z.string().trim().min(1, "Missing id.");

const scalarSchema = z.object({
  itemId: idSchema,
  price: z.string().min(1, "Enter a price."),
  priority: z.coerce.number().int("Priority must be a whole number."),
  label: z.string().trim().max(200, "Label is too long."),
  scope: z.enum(["all", "custom"]),
  days: z.array(z.string()),
  allHours: z.boolean(),
  startMinute: z.string(),
  endMinute: z.string(),
  confirmed: z.boolean(),
});

type Scalars = z.infer<typeof scalarSchema>;

/** Read the raw FormData into the plain-string shape the Zod schema expects. */
function readForm(formData: FormData): Record<string, unknown> {
  const str = (k: string): string => {
    const v = formData.get(k);
    return typeof v === "string" ? v : "";
  };
  return {
    itemId: str("itemId"),
    id: str("id"),
    price: str("price"),
    priority: str("priority") || "0",
    label: str("label"),
    scope: str("scope") || "all",
    days: formData.getAll("days").map(String),
    allHours: formData.get("allHours") != null,
    startMinute: str("startMinute"),
    endMinute: str("endMinute"),
    confirmed: str("confirmed") === "true",
  };
}

interface ResolvedScope {
  daysOfWeek: number[] | null;
  startMinute: number | null;
  endMinute: number | null;
  priceCents: number | null;
  fieldErrors: Record<string, string>;
}

/** Turn the parsed scalars into a validated price scope + cents, or errors. */
function resolveScope(parsed: Scalars): ResolvedScope {
  const fieldErrors: Record<string, string> = {};

  const daysOfWeek = parsed.scope === "custom" ? parsed.days.map(Number) : null;
  const daysError = validateDaysOfWeek(daysOfWeek);
  if (daysError) fieldErrors.days = daysError;

  let startMinute: number | null = null;
  let endMinute: number | null = null;
  if (!parsed.allHours) {
    startMinute = parsed.startMinute === "" ? null : Number(parsed.startMinute);
    endMinute = parsed.endMinute === "" ? null : Number(parsed.endMinute);
  }
  const hoursError = validateHourWindow(startMinute, endMinute);
  if (hoursError) fieldErrors.endMinute = hoursError;

  const priceCents = parseDollarsToCents(parsed.price);
  if (priceCents === null || priceCents < 0) {
    fieldErrors.price = "Enter a non-negative price in dollars, e.g. 12.34.";
  }

  return {
    daysOfWeek: daysError ? null : daysOfWeek,
    startMinute: hoursError ? null : startMinute,
    endMinute: hoursError ? null : endMinute,
    priceCents,
    fieldErrors,
  };
}

function detailOf(row: ItemPriceRow) {
  return {
    price_cents: row.price_cents,
    days_of_week: row.days_of_week,
    start_minute: row.start_minute,
    end_minute: row.end_minute,
    priority: row.priority,
    label: row.label,
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createPriceAction(
  _prevState: PriceActionState,
  formData: FormData,
): Promise<PriceActionState> {
  const user = await requireScheduler();

  const parsedResult = scalarSchema.safeParse(readForm(formData));
  if (!parsedResult.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsFromZod(parsedResult.error),
    };
  }

  const { daysOfWeek, startMinute, endMinute, priceCents, fieldErrors } =
    resolveScope(parsedResult.data);
  if (Object.keys(fieldErrors).length > 0 || priceCents === null) {
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors };
  }

  const { itemId, priority, label } = parsedResult.data;

  try {
    const created = await withTransaction(async (client) => {
      const row = await createPrice(
        {
          item_id: itemId,
          price_cents: priceCents,
          days_of_week: daysOfWeek,
          start_minute: startMinute,
          end_minute: endMinute,
          priority,
          label: label === "" ? null : label,
        },
        client,
      );
      await writeAuditLog(
        {
          actor_uid: user.uid,
          actor_email: user.email,
          action: "price.create",
          entity: "item_prices",
          entity_id: row.id,
          detail: { before: null, after: detailOf(row) },
        },
        client,
      );
      return row;
    });

    revalidatePath("/prices");
    return { status: "success", message: `Price row created ($${(created.price_cents / 100).toFixed(2)}).` };
  } catch {
    return { status: "error", message: "Could not create the price row. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updatePriceAction(
  _prevState: PriceActionState,
  formData: FormData,
): Promise<PriceActionState> {
  const user = await requireScheduler();

  const idResult = idSchema.safeParse(formData.get("id") ?? "");
  if (!idResult.success) {
    return { status: "error", message: "Missing price row id." };
  }
  const id = idResult.data;

  const parsedResult = scalarSchema.safeParse(readForm(formData));
  if (!parsedResult.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsFromZod(parsedResult.error),
    };
  }

  const { daysOfWeek, startMinute, endMinute, priceCents, fieldErrors } =
    resolveScope(parsedResult.data);
  if (Object.keys(fieldErrors).length > 0 || priceCents === null) {
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors };
  }

  const { itemId, priority, label, confirmed } = parsedResult.data;

  const existing = await getPriceById(id);
  if (!existing || existing.item_id !== itemId) {
    return { status: "error", message: "Price row not found." };
  }

  const nextScope: PriceScope = {
    days_of_week: daysOfWeek,
    start_minute: startMinute,
    end_minute: endMinute,
  };

  if (!confirmed) {
    const rows = await listPricesForItem(itemId);
    if (wouldRemoveBaseRowOnUpdate(rows, id, nextScope)) {
      return {
        status: "warning",
        priceId: id,
        message:
          "This is the item's all-days/all-hours base rate — the storefront can't quote this item without one. Editing it into a scoped override will leave the item with no fallback rate.",
      };
    }
  }

  try {
    const updated = await withTransaction(async (client) => {
      const row = await updatePrice(
        id,
        {
          price_cents: priceCents,
          days_of_week: daysOfWeek,
          start_minute: startMinute,
          end_minute: endMinute,
          priority,
          label: label === "" ? null : label,
        },
        client,
      );
      if (!row) throw new Error("price row not found");
      await writeAuditLog(
        {
          actor_uid: user.uid,
          actor_email: user.email,
          action: "price.update",
          entity: "item_prices",
          entity_id: row.id,
          detail: { before: detailOf(existing), after: detailOf(row) },
        },
        client,
      );
      return row;
    });

    revalidatePath("/prices");
    return { status: "success", message: `Price row updated ($${(updated.price_cents / 100).toFixed(2)}).` };
  } catch {
    return { status: "error", message: "Could not update the price row. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deletePriceAction(
  _prevState: PriceActionState,
  formData: FormData,
): Promise<PriceActionState> {
  const user = await requireScheduler();

  const idResult = idSchema.safeParse(formData.get("id") ?? "");
  const itemIdResult = idSchema.safeParse(formData.get("itemId") ?? "");
  if (!idResult.success || !itemIdResult.success) {
    return { status: "error", message: "Missing price row id." };
  }
  const id = idResult.data;
  const itemId = itemIdResult.data;
  const confirmed = formData.get("confirmed") === "true";

  const existing = await getPriceById(id);
  if (!existing || existing.item_id !== itemId) {
    return { status: "error", message: "Price row not found." };
  }

  if (!confirmed) {
    const rows = await listPricesForItem(itemId);
    if (wouldRemoveBaseRowOnDelete(rows, id)) {
      return {
        status: "warning",
        priceId: id,
        message:
          "This is the item's all-days/all-hours base rate — the storefront can't quote this item without one. Deleting it will leave the item with no fallback rate.",
      };
    }
  }

  try {
    await withTransaction(async (client) => {
      const removed = await deletePrice(id, client);
      if (!removed) throw new Error("price row not found");
      await writeAuditLog(
        {
          actor_uid: user.uid,
          actor_email: user.email,
          action: "price.delete",
          entity: "item_prices",
          entity_id: id,
          detail: { before: detailOf(existing), after: null },
        },
        client,
      );
    });

    revalidatePath("/prices");
    return { status: "success", message: "Price row deleted." };
  } catch {
    return { status: "error", message: "Could not delete the price row. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function fieldErrorsFromZod(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    fieldErrors[issue.path.join(".")] = issue.message;
  }
  return fieldErrors;
}
