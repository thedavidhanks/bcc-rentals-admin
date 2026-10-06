import Link from "next/link";

import { requireScheduler } from "@/lib/auth/guards";
import {
  type CalendarBar,
  type CalendarFilters,
  type CalendarBarItem,
  type CalendarView,
  applyCalendarFilters,
  buildCalendarBars,
  countActiveFilters,
  parseCalendarParams,
} from "@/lib/calendar/bars";
import { MONTH_DAY_OVERFLOW_CAP, monthGridForAnchor, nextMonthIso, prevMonthIso } from "@/lib/calendar/month";
import {
  BCC_TIMEZONE,
  DAYS_PER_WEEK,
  buildWeekDays,
  easternDayNumber,
  easternMidnightInstant,
  nextWeekIso,
  placeInWeek,
  prevWeekIso,
  resolveAnchorDay,
  weekRangeForAnchor,
  type PlacedBar,
  type WeekDay,
  type WeekRange,
} from "@/lib/calendar/week";
import { formatDays } from "@/lib/scheduler/recurrence";
import type { ReservationRow, ReservationStatus } from "@/lib/repositories/types";

import { FilterFlyout, type FilterFlyoutItem } from "./filter-flyout";
import styles from "./page.module.css";

// The calendar reads the live DB per request and depends on ?week/?view — never
// prerender it. This also keeps `next build` from importing the DB/env chain at
// build time (that import is deferred to request time via dynamic import below).
export const dynamic = "force-dynamic";

const ADD_RESERVATION_HREF = "/reservations/new"; // owned by P6.1 (placeholder target)

// ---------------------------------------------------------------------------
// Data loading (deferred import: keeps the build free of DB/env requirements)
// ---------------------------------------------------------------------------

interface CalendarData {
  rows: ReservationRow[];
  items: Map<string, CalendarBarItem>;
  groupTitles: Map<string, string | null>;
  /** Full catalog (slug + name), for the filter flyout's product checkboxes. */
  catalog: FilterFlyoutItem[];
}

async function loadCalendarData(start: Date, end: Date): Promise<CalendarData> {
  // Imported lazily so `next build` (which runs without DATABASE_URL) does not
  // evaluate lib/env's boot-time validation. At request time env is present.
  const [{ listReservationsInRange }, { listItems }, { listReservationGroupsByIds }] =
    await Promise.all([
      import("@/lib/repositories/reservations"),
      import("@/lib/repositories/items"),
      import("@/lib/repositories/reservation-groups"),
    ]);

  const [rows, itemRows] = await Promise.all([
    // Include cancelled so they can be greyed out / hidden by the filter (P11.7).
    listReservationsInRange(start, end, { includeCancelled: true }),
    listItems(),
  ]);

  const items = new Map(itemRows.map((i) => [i.id, { name: i.name, slug: i.slug }]));
  const catalog = itemRows.map((i) => ({ slug: i.slug, name: i.name }));

  const groupIds = Array.from(
    new Set(rows.map((r) => r.group_id).filter((id): id is string => id !== null)),
  );
  const groups = await listReservationGroupsByIds(groupIds);
  const groupTitles = new Map(groups.map((g) => [g.id, g.title]));

  return { rows, items, groupTitles, catalog };
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

const rangeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: BCC_TIMEZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
});

const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: BCC_TIMEZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function statusClass(status: ReservationStatus): string {
  if (status === "cancelled") return styles.cancelled;
  if (status === "confirmed") return styles.confirmed;
  return styles.block;
}

function statusLabel(status: ReservationStatus): string {
  if (status === "cancelled") return "Cancelled";
  if (status === "confirmed") return "Confirmed";
  return "Block";
}

/** The native-tooltip text for a bar — shared by the week and month views. */
function buildBarTooltip(bar: CalendarBar): string {
  return [
    `${bar.label} — ${statusLabel(bar.status)}`,
    bar.itemNames.length > 0 ? `Items: ${bar.itemNames.join(", ")}` : null,
    `${dateTimeFmt.format(bar.start_at)} → ${dateTimeFmt.format(bar.end_at)}`,
    bar.customerName ? `Contact: ${bar.customerName}` : null,
    bar.notes ? `Notes: ${bar.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** A bar resolved to a placement within one visible week row, ready to render. */
interface LaidOutBar {
  bar: CalendarBar;
  placement: PlacedBar;
}

/**
 * Stable render order: active bars first, then left-to-right by column, then
 * earliest start, with a final tie-break on the bar's own stable `key` —
 * never on `Map`/object iteration order (work order §3.1).
 */
function sortForRender(a: LaidOutBar, b: LaidOutBar): number {
  const ac = a.bar.status === "cancelled" ? 1 : 0;
  const bc = b.bar.status === "cancelled" ? 1 : 0;
  if (ac !== bc) return ac - bc;
  if (a.placement.startCol !== b.placement.startCol) {
    return a.placement.startCol - b.placement.startCol;
  }
  const startDiff = a.bar.start_at.getTime() - b.bar.start_at.getTime();
  if (startDiff !== 0) return startDiff;
  return a.bar.key.localeCompare(b.bar.key);
}

function placeAndSort(bars: CalendarBar[], range: WeekRange): LaidOutBar[] {
  return bars
    .map((bar): LaidOutBar | null => {
      const placement = placeInWeek(bar, range);
      if (!placement) return null;
      return { bar, placement };
    })
    .filter((b): b is LaidOutBar => b !== null)
    .sort(sortForRender);
}

/** One visible week row of the month grid, laid out into capped bar "lanes". */
interface MonthWeekLayout {
  days: WeekDay[];
  /** `laneRows[lane]` holds the bars sharing that stacked row, lane < cap. */
  laneRows: LaidOutBar[][];
  /** Per day-column (0=Sun..6=Sat) count of bars pushed past the cap. */
  overflowCounts: number[];
}

/**
 * Greedy interval-packing into up to `MONTH_DAY_OVERFLOW_CAP` stacked lanes
 * per week row (work order §3.3 judgment call §4.4: cap is a named constant,
 * not perf-tuned). Bars beyond the cap aren't rendered as bars; each day they
 * touch gets its `overflowCounts` incremented for a "+N more" indicator.
 */
function layoutMonthWeek(range: WeekRange, bars: CalendarBar[], todayDay: number): MonthWeekLayout {
  const days = buildWeekDays(range, todayDay);
  const placed = placeAndSort(bars, range);

  const laneEnds: number[] = [];
  const laneRows: LaidOutBar[][] = [];
  const overflowCounts = new Array(DAYS_PER_WEEK).fill(0) as number[];

  for (const item of placed) {
    let lane = laneEnds.findIndex((end) => end < item.placement.startCol);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = item.placement.endCol;

    if (lane < MONTH_DAY_OVERFLOW_CAP) {
      (laneRows[lane] ??= []).push(item);
    } else {
      for (let d = item.placement.startCol; d <= item.placement.endCol; d++) {
        overflowCounts[d] += 1;
      }
    }
  }

  return { days, laneRows, overflowCounts };
}

/** Build a `/calendar` href carrying the anchor, view, and filter state. */
function buildHref(weekIso: string | null, view: CalendarView, filters: CalendarFilters): string {
  const qp = new URLSearchParams();
  if (weekIso) qp.set("week", weekIso);
  if (view === "month") qp.set("view", "month");
  if (filters.showCancelled) qp.set("cancelled", "1");
  for (const slug of filters.itemSlugs ?? []) qp.append("items", slug);
  const qs = qp.toString();
  return qs ? `/calendar?${qs}` : "/calendar";
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{
    week?: string | string[];
    view?: string | string[];
    cancelled?: string | string[];
    items?: string | string[];
  }>;
}) {
  // Scheduler+admin view; unauthenticated/unknown users are redirected/denied
  // (P4.3, resolved at wave-3 integration — replaces the prior TODO placeholder).
  await requireScheduler();

  const params = await searchParams;
  const { view, weekParam, filters } = parseCalendarParams(params);

  const now = new Date();
  const anchorDay = resolveAnchorDay(weekParam, now);
  const todayDay = easternDayNumber(now);
  const anchorIso = formatDays(anchorDay);

  // The visible instant window differs by view; both load through the same
  // pipeline (buildCalendarBars -> applyCalendarFilters) either way.
  const range = view === "week" ? weekRangeForAnchor(anchorDay) : null;
  const grid = view === "month" ? monthGridForAnchor(anchorDay) : null;
  const windowStart = range
    ? easternMidnightInstant(range.startDay)
    : easternMidnightInstant(grid!.weeks[0].startDay);
  const windowEnd = range
    ? easternMidnightInstant(range.endDay + 1)
    : easternMidnightInstant(grid!.weeks[grid!.weeks.length - 1].endDay + 1);

  let visibleBars: CalendarBar[] = [];
  let catalog: FilterFlyoutItem[] = [];
  let loadError: string | null = null;
  try {
    const data = await loadCalendarData(windowStart, windowEnd);
    catalog = data.catalog;
    const bars = buildCalendarBars(data.rows, data.items, data.groupTitles);
    visibleBars = applyCalendarFilters(bars, filters);
  } catch {
    loadError =
      "Could not load reservations. Check the database connection and try again.";
  }

  const weekDays = range ? buildWeekDays(range, todayDay) : [];
  const laidOut = range ? placeAndSort(visibleBars, range) : [];
  const monthWeeks = grid
    ? grid.weeks.map((weekRange) => layoutMonthWeek(weekRange, visibleBars, todayDay))
    : [];

  const prevHref = range
    ? buildHref(prevWeekIso(range), "week", filters)
    : buildHref(prevMonthIso(anchorDay), "month", filters);
  const nextHref = range
    ? buildHref(nextWeekIso(range), "week", filters)
    : buildHref(nextMonthIso(anchorDay), "month", filters);
  const todayHref = buildHref(null, view, filters);

  const rangeLabel = range
    ? `${rangeFmt.format(easternMidnightInstant(range.startDay))} – ${rangeFmt.format(
        easternMidnightInstant(range.endDay),
      )}`
    : grid!.label;

  const unitLabel = view === "month" ? "month" : "week";

  return (
    <main className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.title}>
          Calendar
          <span className={styles.rangeLabel}>{rangeLabel}</span>
        </h1>

        <nav className={styles.viewToggle} aria-label="Calendar view">
          <Link
            className={`${styles.viewLink} ${view === "week" ? styles.viewLinkActive : ""}`}
            href={buildHref(anchorIso, "week", filters)}
            aria-current={view === "week" ? "page" : undefined}
          >
            Week
          </Link>
          <Link
            className={`${styles.viewLink} ${view === "month" ? styles.viewLinkActive : ""}`}
            href={buildHref(anchorIso, "month", filters)}
            aria-current={view === "month" ? "page" : undefined}
          >
            Month
          </Link>
        </nav>

        <Link className={styles.navBtn} href={prevHref} aria-label={`Previous ${unitLabel}`}>
          ‹ Prev
        </Link>
        <Link className={styles.navBtn} href={todayHref} aria-label={`Current ${unitLabel}`}>
          Today
        </Link>
        <Link className={styles.navBtn} href={nextHref} aria-label={`Next ${unitLabel}`}>
          Next ›
        </Link>
        <FilterFlyout
          items={catalog}
          showCancelled={filters.showCancelled}
          selectedSlugs={filters.itemSlugs ?? []}
          weekIso={anchorIso}
          view={view}
          activeCount={countActiveFilters(filters)}
        />
        <Link
          className={styles.addBtn}
          href={ADD_RESERVATION_HREF}
          aria-label="Add reservation"
          title="Add reservation"
        >
          +
        </Link>
      </div>

      {view === "week" ? (
        <>
          <div className={styles.weekHeader}>
            {weekDays.map((d) => (
              <div key={d.iso} className={`${styles.dayHead} ${d.isToday ? styles.today : ""}`}>
                <span className={styles.dayName}>{d.label}</span>
                <span className={styles.dayNum}>{d.dayOfMonth}</span>
              </div>
            ))}
          </div>

          <div className={styles.weekBody}>
            {laidOut.length === 0 && !loadError && (
              <p className={styles.empty}>No reservations this week.</p>
            )}
            {laidOut.map(({ bar, placement }, index) => {
              // Bars with a group_id link to the Edit Reservation page (P6.2);
              // it now represents N rows instead of 1. Storefront confirmed
              // rows may have no group — those stay non-clickable. Same
              // rendered box either way.
              const barProps = {
                className: `${styles.bar} ${statusClass(bar.status)}`,
                style: {
                  gridColumn: `${placement.startCol + 1} / ${placement.endCol + 2}`,
                  gridRow: index + 1,
                },
                title: buildBarTooltip(bar),
              };
              const barBody = (
                <>
                  {placement.continuesBefore && (
                    <span className={styles.cont} aria-label="continues from previous week">
                      ‹
                    </span>
                  )}
                  <span className={styles.barLabel}>
                    {bar.label}
                    {bar.subtitle ? ` · ${bar.subtitle}` : ""}
                  </span>
                  <span className={styles.barMeta}>{statusLabel(bar.status)}</span>
                  {placement.continuesAfter && (
                    <span className={styles.cont} aria-label="continues into next week">
                      ›
                    </span>
                  )}
                </>
              );
              return bar.groupId ? (
                <Link key={bar.key} href={`/reservations/${bar.groupId}`} {...barProps}>
                  {barBody}
                </Link>
              ) : (
                <div key={bar.key} {...barProps}>
                  {barBody}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className={styles.monthGrid}>
          <div className={styles.weekHeader}>
            {monthWeeks[0]?.days.map((d) => (
              <div key={d.weekday} className={styles.dayHead}>
                <span className={styles.dayName}>{d.label}</span>
              </div>
            ))}
          </div>

          {monthWeeks.length === 0 && !loadError && (
            <p className={styles.empty}>No reservations this month.</p>
          )}

          {monthWeeks.map((weekLayout, weekIndex) => (
            <div
              key={weekIndex}
              className={styles.monthWeek}
              style={{
                gridTemplateRows: `auto repeat(${MONTH_DAY_OVERFLOW_CAP}, minmax(1.2rem, auto)) auto`,
              }}
            >
              {weekLayout.days.map((d, dayIndex) => {
                const inMonth = grid && d.dayNumber >= grid.monthStartDay && d.dayNumber <= grid.monthEndDay;
                return (
                  <div
                    key={d.iso}
                    className={`${styles.monthDayHead} ${d.isToday ? styles.today : ""} ${
                      inMonth ? "" : styles.monthDayOutside
                    }`}
                    style={{ gridColumn: dayIndex + 1, gridRow: 1 }}
                  >
                    {d.dayOfMonth}
                  </div>
                );
              })}

              {weekLayout.laneRows.map((lane, laneIndex) =>
                lane.map(({ bar, placement }) => (
                  bar.groupId ? (
                    <Link
                      key={bar.key}
                      href={`/reservations/${bar.groupId}`}
                      className={`${styles.monthBar} ${statusClass(bar.status)}`}
                      style={{
                        gridColumn: `${placement.startCol + 1} / ${placement.endCol + 2}`,
                        gridRow: laneIndex + 2,
                      }}
                      title={buildBarTooltip(bar)}
                    >
                      {placement.continuesBefore && "‹ "}
                      {bar.label}
                      {placement.continuesAfter && " ›"}
                    </Link>
                  ) : (
                    <div
                      key={bar.key}
                      className={`${styles.monthBar} ${statusClass(bar.status)}`}
                      style={{
                        gridColumn: `${placement.startCol + 1} / ${placement.endCol + 2}`,
                        gridRow: laneIndex + 2,
                      }}
                      title={buildBarTooltip(bar)}
                    >
                      {placement.continuesBefore && "‹ "}
                      {bar.label}
                      {placement.continuesAfter && " ›"}
                    </div>
                  )
                )),
              )}

              {weekLayout.overflowCounts.map((count, dayIndex) =>
                count > 0 ? (
                  <div
                    key={`overflow-${dayIndex}`}
                    className={styles.monthMore}
                    style={{ gridColumn: dayIndex + 1, gridRow: MONTH_DAY_OVERFLOW_CAP + 2 }}
                  >
                    +{count} more
                  </div>
                ) : null,
              )}
            </div>
          ))}
        </div>
      )}

      {loadError && <p className={styles.error}>{loadError}</p>}

      <div className={styles.legend}>
        <span>
          <span className={`${styles.swatch} ${styles.confirmed}`} />
          Confirmed (storefront)
        </span>
        <span>
          <span className={`${styles.swatch} ${styles.block}`} />
          Block (staff)
        </span>
        <span>
          <span className={`${styles.swatch} ${styles.cancelled}`} />
          Cancelled
        </span>
      </div>
    </main>
  );
}
