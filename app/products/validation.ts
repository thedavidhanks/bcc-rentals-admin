import { z } from "zod";

import type { AvailableHours, ItemType, PricingUnit } from "@/lib/repositories/types";

// Pure validation/parsing helpers for the Products admin (execution-plan P6.4,
// spec §4/§6/§7). Deliberately NOT "use server" and NOT importing "server-only"
// so tests can import it directly with no DB/auth mocking.
//
// These mirror the `items` table's check constraints (spec §4) so a violation
// is caught here instead of throwing at the DB. Money/time conventions
// (CLAUDE.md): integer cents, Eastern minutes-since-midnight — this module
// never produces a float or a parsed-with-parseFloat cents value.

// ---------------------------------------------------------------------------
// slug
// ---------------------------------------------------------------------------

// Lowercase alphanumeric + single hyphens; no leading/trailing/double hyphens.
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const slugSchema = z
  .string()
  .trim()
  .min(1, "Slug is required.")
  .max(200)
  .regex(
    SLUG_PATTERN,
    "Use lowercase letters, numbers, and single hyphens only (e.g. party-room).",
  );

/** Convenience: derive a candidate slug from a display name (not validated). */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

// ---------------------------------------------------------------------------
// money: dollars string -> integer cents, no floating-point drift
// ---------------------------------------------------------------------------

const DOLLARS_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * Parses a dollar-amount string (e.g. "25", "25.5", "25.50") into integer
 * cents via string splitting — never `Math.round(parseFloat(x) * 100)`, which
 * can drift on values like "0.1". Rejects negative amounts, currency symbols,
 * more than 2 decimal places, and anything non-numeric.
 */
export const dollarsToCentsSchema = z
  .string()
  .trim()
  .regex(DOLLARS_PATTERN, "Enter a price like 25 or 25.50.")
  .transform((value) => {
    const [dollarsPart, centsPart = ""] = value.split(".");
    const centsStr = `${centsPart}00`.slice(0, 2);
    return Number(dollarsPart) * 100 + Number(centsStr);
  });

// ---------------------------------------------------------------------------
// items fields
// ---------------------------------------------------------------------------

export const itemTypeSchema: z.ZodType<ItemType> = z.enum(["unique", "fungible"]);
export const pricingUnitSchema: z.ZodType<PricingUnit> = z.enum([
  "hour",
  "day",
  "event",
]);

export const availableHoursSchema: z.ZodType<AvailableHours> = z
  .object({
    openHour: z
      .number({ invalid_type_error: "Open hour is required." })
      .int("Open hour must be a whole number.")
      .min(0, "Open hour must be 0 or later.")
      .max(24, "Open hour must be 24 or earlier."),
    closeHour: z
      .number({ invalid_type_error: "Close hour is required." })
      .int("Close hour must be a whole number.")
      .min(0, "Close hour must be 0 or later.")
      .max(24, "Close hour must be 24 or earlier."),
    slotMinutes: z
      .number({ invalid_type_error: "Slot minutes is required." })
      .int("Slot minutes must be a whole number.")
      .positive("Slot minutes must be greater than 0."),
  })
  .refine((h) => h.openHour < h.closeHour, {
    message: "Open hour must be earlier than close hour.",
    path: ["closeHour"],
  });

/** Raw (string-keyed) shape produced by `readItemFormFields`, pre-Zod. */
export interface RawItemFormFields {
  slug: string;
  name: string;
  type: string;
  totalStock: number | undefined;
  active: boolean;
  shortDescription: string | undefined;
  longDescription: string | undefined;
  highlights: string[] | undefined;
  image: string | undefined;
  pricingUnit: string;
  minMinutes: number | undefined;
  maxMinutes: number | undefined;
  bufferMinutes: number | undefined;
  leadHours: number | undefined;
  horizonDays: number | undefined;
  availableHours: { openHour: number | undefined; closeHour: number | undefined; slotMinutes: number | undefined } | null;
  sortOrder: number | undefined;
}

export const itemFieldsSchema = z
  .object({
    slug: slugSchema,
    name: z.string().trim().min(1, "Name is required.").max(200),
    type: itemTypeSchema,
    totalStock: z
      .number({ invalid_type_error: "Total stock is required." })
      .int("Total stock must be a whole number.")
      .positive("Total stock must be greater than 0."),
    active: z.boolean().default(true),
    shortDescription: z.string().trim().max(2000).optional(),
    longDescription: z.string().trim().max(20000).optional(),
    highlights: z.array(z.string().trim().min(1)).optional(),
    image: z.string().trim().max(500).optional(),
    pricingUnit: pricingUnitSchema,
    minMinutes: z
      .number({ invalid_type_error: "Min minutes must be a number." })
      .int("Min minutes must be a whole number.")
      .positive("Min minutes must be greater than 0.")
      .optional(),
    maxMinutes: z
      .number({ invalid_type_error: "Max minutes must be a number." })
      .int("Max minutes must be a whole number.")
      .positive("Max minutes must be greater than 0.")
      .optional(),
    bufferMinutes: z
      .number({ invalid_type_error: "Buffer minutes must be a number." })
      .int("Buffer minutes must be a whole number.")
      .min(0, "Buffer minutes must be 0 or greater.")
      .default(0),
    leadHours: z
      .number({ invalid_type_error: "Lead hours must be a number." })
      .int("Lead hours must be a whole number.")
      .min(0, "Lead hours must be 0 or greater.")
      .default(0),
    horizonDays: z
      .number({ invalid_type_error: "Horizon days must be a number." })
      .int("Horizon days must be a whole number.")
      .positive("Horizon days must be greater than 0.")
      .default(365),
    availableHours: availableHoursSchema.nullable().default(null),
    sortOrder: z
      .number({ invalid_type_error: "Sort order must be a number." })
      .int("Sort order must be a whole number.")
      .default(0),
  })
  .superRefine((val, ctx) => {
    if (val.type === "unique" && val.totalStock !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Unique items must have total stock of exactly 1.",
        path: ["totalStock"],
      });
    }
    if (
      val.minMinutes != null &&
      val.maxMinutes != null &&
      val.maxMinutes < val.minMinutes
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Max minutes must be greater than or equal to min minutes.",
        path: ["maxMinutes"],
      });
    }
  });

export type ItemFormFields = z.infer<typeof itemFieldsSchema>;

// ---------------------------------------------------------------------------
// FormData -> RawItemFormFields
// ---------------------------------------------------------------------------

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

function optStr(formData: FormData, key: string): string | undefined {
  const v = str(formData, key).trim();
  return v.length > 0 ? v : undefined;
}

/** Reads a numeric field; blank => `fallback` (or undefined for optional). */
function num(
  formData: FormData,
  key: string,
  fallback?: number,
): number | undefined {
  const v = str(formData, key).trim();
  if (v.length === 0) return fallback;
  return Number(v); // may be NaN — the zod schema rejects that with a message
}

/**
 * Reads the flat FormData an Add/Edit Product form submits into the shape
 * `itemFieldsSchema` validates. `highlights` is a textarea, one bullet per
 * line — blank lines are dropped. `availableHoursEnabled` gates whether the
 * open/close/slot trio is read at all (unchecked => null, "unrestricted").
 */
export function readItemFormFields(formData: FormData): RawItemFormFields {
  const highlights = str(formData, "highlights")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const availableHoursEnabled = formData.get("availableHoursEnabled") === "on";

  return {
    slug: str(formData, "slug"),
    name: str(formData, "name"),
    type: str(formData, "type"),
    totalStock: num(formData, "totalStock"),
    active: formData.get("active") === "on",
    shortDescription: optStr(formData, "shortDescription"),
    longDescription: optStr(formData, "longDescription"),
    highlights: highlights.length > 0 ? highlights : undefined,
    image: optStr(formData, "image"),
    pricingUnit: str(formData, "pricingUnit"),
    minMinutes: num(formData, "minMinutes"),
    maxMinutes: num(formData, "maxMinutes"),
    bufferMinutes: num(formData, "bufferMinutes", 0),
    leadHours: num(formData, "leadHours", 0),
    horizonDays: num(formData, "horizonDays", 365),
    availableHours: availableHoursEnabled
      ? {
          openHour: num(formData, "availableHoursOpen"),
          closeHour: num(formData, "availableHoursClose"),
          slotMinutes: num(formData, "availableHoursSlot"),
        }
      : null,
    sortOrder: num(formData, "sortOrder", 0),
  };
}

// ---------------------------------------------------------------------------
// shared zod-error helper
// ---------------------------------------------------------------------------

export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".");
    if (!(path in fieldErrors)) fieldErrors[path] = issue.message;
  }
  return fieldErrors;
}
