import { notFound } from "next/navigation";

import { requireScheduler } from "@/lib/auth/guards";

import { ReservationEditForm } from "./reservation-edit-form";
import type { LoadedReservation } from "./loader";

// The edit page reads the live booking + active catalog per request; never
// prerender it. The loader's DB imports are deferred (like the loader/add page)
// so `next build` stays free of DATABASE_URL / env boot validation.
export const dynamic = "force-dynamic";

export default async function EditReservationPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  // Scheduler+admin only; unauthenticated/unknown users redirected/denied (§3).
  await requireScheduler();

  const { groupId } = await params;

  let loaded: LoadedReservation | null = null;
  let loadError: string | null = null;
  try {
    // Deferred import: loader.ts is server-only (touches the DB); importing it
    // lazily keeps `next build` free of env boot validation, matching the add
    // page's loadActiveItems pattern.
    const { loadReservationForEdit } = await import("./loader");
    loaded = await loadReservationForEdit(groupId);
  } catch {
    loadError = "Could not load the reservation. Check the database connection.";
  }

  // Unknown group_id → 404 (spec §7). Only after a clean load — a DB error is
  // surfaced as a load error, not a spurious not-found.
  if (!loadError && !loaded) {
    notFound();
  }

  return <ReservationEditForm loaded={loaded} loadError={loadError} />;
}
