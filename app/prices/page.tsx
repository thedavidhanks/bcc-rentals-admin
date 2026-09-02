import { requireScheduler } from "@/lib/auth/guards";

import { isBaseRow } from "./pricing";
import { PricesManager, type ItemOption, type PriceRowView } from "./prices-manager";

// Update Prices page (execution-plan P6.3, spec §6/§7). SCHEDULER-OR-ADMIN —
// both roles may manage prices per the spec §1 matrix (server-enforced by
// requireScheduler; the nav shows this to both roles too). The catalog + price
// list are read per request; never prerender, and defer the DB imports so
// `next build` stays free of DATABASE_URL / env boot validation (mirrors
// app/users/page.tsx / app/reservations/new/page.tsx).
export const dynamic = "force-dynamic";

async function loadItems() {
  const { listItems } = await import("@/lib/repositories/items");
  // Include inactive items too (§7 lets staff manage prices for any item) —
  // the client marks inactive ones so they aren't mistaken for live products.
  return listItems();
}

async function loadPrices(itemId: string) {
  const { listPricesForItem } = await import("@/lib/repositories/item-prices");
  return listPricesForItem(itemId);
}

export default async function PricesPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string | string[] }>;
}) {
  // Scheduler+admin only; unauthenticated/unknown users redirected/denied (§3).
  await requireScheduler();

  const params = await searchParams;
  const itemParam = Array.isArray(params.item) ? params.item[0] : params.item;

  let items: ItemOption[] = [];
  let loadError: string | null = null;
  try {
    const rows = await loadItems();
    items = rows.map((i) => ({ id: i.id, slug: i.slug, name: i.name, active: i.active }));
  } catch {
    loadError = "Could not load the product catalog. Check the database connection.";
  }

  const selected = itemParam
    ? items.find((i) => i.id === itemParam || i.slug === itemParam) ?? null
    : items[0] ?? null;

  let prices: PriceRowView[] = [];
  if (selected && !loadError) {
    try {
      const rows = await loadPrices(selected.id);
      prices = rows.map((r) => ({
        id: r.id,
        priceCents: r.price_cents,
        daysOfWeek: r.days_of_week,
        startMinute: r.start_minute,
        endMinute: r.end_minute,
        priority: r.priority,
        label: r.label,
        isBase: isBaseRow(r),
      }));
    } catch {
      loadError = "Could not load prices for this item. Check the database connection.";
    }
  }

  return (
    <PricesManager
      items={items}
      selectedItemId={selected?.id ?? null}
      prices={prices}
      loadError={loadError}
    />
  );
}
