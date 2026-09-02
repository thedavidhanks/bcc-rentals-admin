import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth/guards";

import { ProductForm, type ProductFormValues } from "../product-form";

// Edit Product page (execution-plan P6.4, spec §6/§7). Admin-only. The page
// reads the live item per request; never prerender it, and defer the DB
// import so `next build` stays free of DATABASE_URL / env boot validation
// (mirrors app/reservations/[groupId]/page.tsx).
export const dynamic = "force-dynamic";

async function loadItem(id: string): Promise<ProductFormValues | null> {
  const { getItemById } = await import("@/lib/repositories/items");
  const item = await getItemById(id);
  if (!item) return null;

  return {
    id: item.id,
    slug: item.slug,
    name: item.name,
    type: item.type,
    totalStock: String(item.total_stock),
    active: item.active,
    shortDescription: item.short_description ?? "",
    longDescription: item.long_description ?? "",
    highlights: (item.highlights ?? []).join("\n"),
    image: item.image ?? "",
    pricingUnit: item.pricing_unit,
    minMinutes: item.min_minutes != null ? String(item.min_minutes) : "",
    maxMinutes: item.max_minutes != null ? String(item.max_minutes) : "",
    bufferMinutes: String(item.buffer_minutes),
    leadHours: String(item.lead_hours),
    horizonDays: String(item.horizon_days),
    availableHoursEnabled: item.available_hours != null,
    availableHoursOpen:
      item.available_hours != null ? String(item.available_hours.openHour) : "",
    availableHoursClose:
      item.available_hours != null ? String(item.available_hours.closeHour) : "",
    availableHoursSlot:
      item.available_hours != null ? String(item.available_hours.slotMinutes) : "",
    sortOrder: String(item.sort_order),
  };
}

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Admin only; unauthenticated → /login, scheduler → ForbiddenError (spec §3).
  await requireAdmin();

  const { id } = await params;

  let item: ProductFormValues | null = null;
  let loadError: string | null = null;
  try {
    item = await loadItem(id);
  } catch {
    loadError = "Could not load the product. Check the database connection.";
  }

  // Unknown id → 404 (spec §7). Only after a clean load — a DB error is
  // surfaced as a load error, not a spurious not-found.
  if (!loadError && !item) {
    notFound();
  }

  return <ProductForm mode="edit" initial={item ?? undefined} loadError={loadError} />;
}
