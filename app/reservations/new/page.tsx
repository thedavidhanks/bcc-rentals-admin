import { requireScheduler } from "@/lib/auth/guards";

import { ReservationForm, type ItemOption } from "./reservation-form";

// The form reads the live active catalog per request; never prerender it. The DB
// import is deferred to request time (like app/calendar/page.tsx) so `next build`
// stays free of DATABASE_URL / env boot validation.
export const dynamic = "force-dynamic";

async function loadActiveItems(): Promise<ItemOption[]> {
  // Deferred import: keeps the build DB-free (env validates at request time).
  const { listItems } = await import("@/lib/repositories/items");
  const items = await listItems({ activeOnly: true });
  return items.map((i) => ({ slug: i.slug, name: i.name }));
}

export default async function AddReservationPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  // Scheduler+admin only; unauthenticated/unknown users redirected/denied (§3).
  await requireScheduler();

  const params = await searchParams;
  const dateParam = Array.isArray(params.date) ? params.date[0] : params.date;
  const defaultDate = /^\d{4}-\d{2}-\d{2}$/.test(dateParam ?? "") ? dateParam : undefined;

  let items: ItemOption[] = [];
  let loadError: string | null = null;
  try {
    items = await loadActiveItems();
  } catch {
    loadError = "Could not load the product catalog. Check the database connection.";
  }

  return <ReservationForm items={items} defaultDate={defaultDate} loadError={loadError} />;
}
