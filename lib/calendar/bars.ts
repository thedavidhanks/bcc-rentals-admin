// Calendar bar construction (execution-plan task P11.6) + URL-driven filtering
// (P11.7). A PURE module (no DB, no secrets, no `import "server-only"`, no
// Next.js APIs) — see tests/calendar-bars.test.ts. This is the layer that turns
// raw `reservations` rows into the "bars" the weekly/monthly grids render, one
// per `reservation_group` instead of one per row.
//
// Pipeline (see docs/prompts/P11.5-P11.6-P11.7-calendar-wave.md §2):
//   searchParams ──► parseCalendarParams()                    [pure, this file]
//   loadCalendarData()        → { rows, items, groupTitles }  [server, page.tsx]
//   buildCalendarBars(rows, items, groupTitles) → CalendarBar[]       [pure]
//   applyCalendarFilters(bars, filters)         → CalendarBar[]       [pure]
//   placeInWeek(bar, weekRange) per visible week row   (lib/calendar/week.ts)

import type { ReservationRow, ReservationStatus } from "@/lib/repositories/types";

// ---------------------------------------------------------------------------
// CalendarBar
// ---------------------------------------------------------------------------

/** Minimal item metadata a bar needs: display name + the URL-filterable slug. */
export interface CalendarBarItem {
  name: string;
  slug: string;
}

/**
 * One renderable calendar bar. Rows sharing a `group_id` collapse into a
 * single bar (P11.6); a row with no `group_id` (storefront bookings) is its
 * own one-row bar. `start_at`/`end_at` form the envelope window and satisfy
 * `HasInstantWindow` (lib/calendar/week.ts), so `placeInWeek` accepts a
 * `CalendarBar` directly.
 */
export interface CalendarBar {
  /** Stable, unique key: the `group_id`, or the lone row's `id` when ungrouped. */
  key: string;
  /** Envelope start: the earliest `start_at` among the bar's displayed rows. */
  start_at: Date;
  /** Envelope end: the latest `end_at` among the bar's displayed rows. */
  end_at: Date;
  /** See the mixed-status precedence rule on `resolveBarStatus` below. */
  status: ReservationStatus;
  /** `reservation_groups.id`, or `null` for an ungrouped (storefront) row. */
  groupId: string | null;
  /** The group's `title`, else the first item's name, else "Unknown item". */
  label: string;
  /** Distinct item names among the bar's displayed rows, in first-seen order. */
  itemNames: string[];
  /** Distinct item slugs among the bar's displayed rows (for the product filter). */
  itemSlugs: string[];
  /** Distinct item ids among the bar's displayed rows (spec-named filter key). */
  itemIds: string[];
  /** `itemNames` joined/truncated for the visible subtitle — see `buildItemSubtitle`. */
  subtitle: string;
  /** A representative row's contact name, for the tooltip (first displayed row's). */
  customerName: string | null;
  /** A representative row's notes, for the tooltip (first displayed row's). */
  notes: string | null;
}

/** Max distinct item names shown inline before collapsing to "+N". */
export const ITEM_SUBTITLE_MAX_NAMES = 2;

/**
 * Build the visible item-list subtitle: up to `ITEM_SUBTITLE_MAX_NAMES` names,
 * comma-joined, with a trailing "+N" for the rest. The full (untruncated) list
 * stays available on `CalendarBar.itemNames` for the native tooltip.
 */
export function buildItemSubtitle(itemNames: string[]): string {
  if (itemNames.length <= ITEM_SUBTITLE_MAX_NAMES) return itemNames.join(", ");
  const shown = itemNames.slice(0, ITEM_SUBTITLE_MAX_NAMES);
  const extra = itemNames.length - shown.length;
  return `${shown.join(", ")} +${extra}`;
}

/**
 * Mixed-status precedence for a group's bar (judgment call, work order §4.1):
 * a bar is `cancelled` only if EVERY row in the group is cancelled; otherwise
 * `confirmed` if ANY row is `confirmed` (a paid storefront line is the most
 * consequential thing in the group); otherwise `block`. A group with one
 * cancelled line among otherwise-live lines is still a live booking.
 */
function resolveBarStatus(rows: ReservationRow[]): ReservationStatus {
  if (rows.every((r) => r.status === "cancelled")) return "cancelled";
  if (rows.some((r) => r.status === "confirmed")) return "confirmed";
  return "block";
}

/** Dedupe by id, preserving first-seen order. */
function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function buildBarFromRows(key: string, groupId: string | null, rows: ReservationRow[], groupTitle: string | null | undefined, items: Map<string, CalendarBarItem>): CalendarBar {
  // Judgment call §4.2: a cancelled line item inside an otherwise-live group
  // must not stretch the envelope or pad the item list. Use only the
  // non-cancelled rows for envelope/label/item-list UNLESS every row is
  // cancelled (then there is nothing else to show, and the bar itself will be
  // `status: 'cancelled'` per resolveBarStatus — hidden entirely unless the
  // "show cancelled" filter is on, P11.7).
  const nonCancelled = rows.filter((r) => r.status !== "cancelled");
  const displayedRows = nonCancelled.length > 0 ? nonCancelled : rows;

  const start_at = new Date(Math.min(...displayedRows.map((r) => r.start_at.getTime())));
  const end_at = new Date(Math.max(...displayedRows.map((r) => r.end_at.getTime())));

  const displayedItems = dedupeById(
    displayedRows.map((r): { id: string } & CalendarBarItem => {
      const item = items.get(r.item_id);
      return { id: r.item_id, name: item?.name ?? "Unknown item", slug: item?.slug ?? "" };
    }),
  );
  const itemNames = displayedItems.map((i) => i.name);
  const itemSlugs = displayedItems.filter((i) => i.slug).map((i) => i.slug);
  const itemIds = displayedItems.map((i) => i.id);

  const label = (groupTitle && groupTitle.trim()) || itemNames[0] || "Unknown item";

  const first = displayedRows[0];
  return {
    key,
    start_at,
    end_at,
    status: resolveBarStatus(rows),
    groupId,
    label,
    itemNames,
    itemSlugs,
    itemIds,
    subtitle: buildItemSubtitle(itemNames),
    customerName: first?.customer_name ?? null,
    notes: first?.notes ?? null,
  };
}

/**
 * Collapse reservation rows into one bar per `group_id`; rows with no
 * `group_id` (storefront bookings) each become their own bar (P11.6).
 *
 * `items` maps `item_id` → display name + slug (slug drives the P11.7 product
 * filter). `groupTitles` maps `group_id` → `reservation_groups.title`
 * (nullable — the fallback chain is group title → first item's name →
 * "Unknown item", never an empty bar).
 */
export function buildCalendarBars(
  rows: ReservationRow[],
  items: Map<string, CalendarBarItem>,
  groupTitles: Map<string, string | null>,
): CalendarBar[] {
  const groups = new Map<string, { groupId: string | null; rows: ReservationRow[] }>();
  for (const row of rows) {
    const key = row.group_id ?? `row:${row.id}`;
    const entry = groups.get(key);
    if (entry) {
      entry.rows.push(row);
    } else {
      groups.set(key, { groupId: row.group_id, rows: [row] });
    }
  }

  return Array.from(groups.entries()).map(([key, { groupId, rows: groupRows }]) =>
    buildBarFromRows(key, groupId, groupRows, groupId ? groupTitles.get(groupId) : undefined, items),
  );
}
