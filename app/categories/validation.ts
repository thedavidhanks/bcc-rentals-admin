import { z } from "zod";

// Pure, DB-free validation helpers for the Categories admin screen (execution-plan
// P6.5, spec §4/§6). Deliberately has NO "server-only" / "use server" markers and
// no DB imports, so it can be unit-tested directly (tests/category-validation.test.ts)
// without mocking the guard, withTransaction, or the repositories. actions.ts wraps
// these with the DB-dependent slug-uniqueness check (getCategoryBySlug) and the
// assigned-products count for the delete confirm step.

/**
 * URL-safe slug: lowercase alphanumeric segments joined by single hyphens, no
 * leading/trailing/double hyphens (e.g. "event-add-on", "room"). Rejects
 * "Party Room" (spaces/case), "party_room" (underscore), "-room" (leading
 * hyphen), "room--tool" (double hyphen).
 */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Suggest a URL-safe slug from a display name. Convenience only — always editable. */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Slug is required.")
  .max(200, "Slug is too long.")
  .regex(
    SLUG_PATTERN,
    "Use lowercase letters, numbers, and single hyphens (e.g. event-add-on).",
  );

const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(200, "Name is too long.");

const sortOrderSchema = z
  .coerce.number({ invalid_type_error: "Sort order must be a whole number." })
  .int("Sort order must be a whole number.")
  .default(0);

export const categoryCreateSchema = z.object({
  slug: slugSchema,
  name: nameSchema,
  sort_order: sortOrderSchema,
});

export const categoryUpdateSchema = z.object({
  id: z.string().trim().min(1, "Missing category id."),
  slug: slugSchema,
  name: nameSchema,
  sort_order: sortOrderSchema,
});

export const categoryIdSchema = z.string().trim().min(1, "Missing category id.");

export const assignSchema = z.object({
  itemId: z.string().trim().min(1, "Missing product id."),
  categoryId: z.string().trim().min(1, "Missing category id."),
});

export const setMembershipSchema = z.object({
  itemId: z.string().trim().min(1, "Missing product id."),
  categoryIds: z.array(z.string().trim().min(1, "Missing category id.")),
});

/** Flatten a ZodError into `{ path: message }` for form field-level display. */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    fieldErrors[issue.path.join(".")] = issue.message;
  }
  return fieldErrors;
}
