import "server-only";

import type {
  ItemRow,
  ReservationGroupRow,
  ReservationRow,
  ReservationSeriesRow,
} from "@/lib/repositories/types";

// Read path for the Edit Reservation page (execution-plan task P6.2, spec
// §7/§9) — Slice A. The page (Slice C) is a server component that forces
// dynamic rendering; this loader gathers everything it needs to render an
// existing booking by group_id in one call:
//   • the reservation_group row (null → the page calls notFound()),
//   • all reservation rows in the group (rendered as line items together),
//   • if the group is part of a series, the series row + its reservation rows
//     (read-only recurrence summary / occurrence count),
//   • the active item catalog for the product dropdown, and
//   • an item_id → slug map so the loaded rows (which store item_id, not slug)
//     resolve to slugs for display/edit — built from the FULL catalog so an
//     inactive item still on an existing booking resolves.
//
// The DB imports are deferred (dynamic import inside the function) so `next
// build` stays free of DATABASE_URL / env boot validation, matching
// app/reservations/new/page.tsx.

/** A product choice for the form's item dropdown. */
export interface ItemOption {
  slug: string;
  name: string;
}

/** Everything the Edit Reservation page needs to render one booking. */
export interface LoadedReservation {
  group: ReservationGroupRow;
  reservations: ReservationRow[];
  /** Non-null only when the group belongs to a recurring series (spec §9). */
  series: ReservationSeriesRow | null;
  /** All reservation rows in the series (empty when not a series). */
  seriesReservations: ReservationRow[];
  /** Active catalog for the product dropdown. */
  items: ItemOption[];
  /** item_id → slug over the FULL catalog (inactive items resolve too). */
  itemSlugById: Record<string, string>;
}

/**
 * Load a booking for editing. Returns null when the group_id does not exist so
 * the caller can render a Next `notFound()`.
 */
export async function loadReservationForEdit(
  groupId: string,
): Promise<LoadedReservation | null> {
  // Deferred imports: keep the build DB-free (env validates at request time).
  const { getReservationGroupById } = await import(
    "@/lib/repositories/reservation-groups"
  );
  const { listReservationsByGroup, listReservationsBySeries } = await import(
    "@/lib/repositories/reservations"
  );
  const { getReservationSeriesById } = await import(
    "@/lib/repositories/reservation-series"
  );
  const { listItems } = await import("@/lib/repositories/items");

  const group = await getReservationGroupById(groupId);
  if (!group) return null;

  const reservations = await listReservationsByGroup(groupId);

  // Series context (read-only) when the group is part of a recurring series.
  let series: ReservationSeriesRow | null = null;
  let seriesReservations: ReservationRow[] = [];
  if (group.series_id) {
    series = await getReservationSeriesById(group.series_id);
    seriesReservations = await listReservationsBySeries(group.series_id);
  }

  // Active catalog for the dropdown; full catalog for id→slug resolution so an
  // inactive item still on this booking renders/edits by slug.
  const activeItems = await listItems({ activeOnly: true });
  const allItems = await listItems();

  const items: ItemOption[] = activeItems.map((i: ItemRow) => ({
    slug: i.slug,
    name: i.name,
  }));

  const itemSlugById: Record<string, string> = {};
  for (const i of allItems) itemSlugById[i.id] = i.slug;

  return { group, reservations, series, seriesReservations, items, itemSlugById };
}
