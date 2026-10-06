import Link from "next/link";

import { requireScheduler } from "@/lib/auth/guards";
import {
  type CalendarBar,
  type CalendarBarItem,
  buildCalendarBars,
} from "@/lib/calendar/bars";
import {
  BCC_TIMEZONE,
  buildWeekDays,
  easternDayNumber,
  easternMidnightInstant,
  nextWeekIso,
  placeInWeek,
  prevWeekIso,
  resolveAnchorDay,
  weekRangeForAnchor,
  type PlacedBar,
} from "@/lib/calendar/week";
import type { ReservationRow, ReservationStatus } from "@/lib/repositories/types";

import styles from "./page.module.css";

// The calendar reads the live DB per request and depends on ?week — never
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

  const groupIds = Array.from(
    new Set(rows.map((r) => r.group_id).filter((id): id is string => id !== null)),
  );
  const groups = await listReservationGroupsByIds(groupIds);
  const groupTitles = new Map(groups.map((g) => [g.id, g.title]));

  return { rows, items, groupTitles };
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

/** A bar resolved to a week placement, ready to render. */
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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string | string[] }>;
}) {
  // Scheduler+admin view; unauthenticated/unknown users are redirected/denied
  // (P4.3, resolved at wave-3 integration — replaces the prior TODO placeholder).
  await requireScheduler();

  const params = await searchParams;
  const weekParam = Array.isArray(params.week) ? params.week[0] : params.week;

  const now = new Date();
  const anchorDay = resolveAnchorDay(weekParam, now);
  const range = weekRangeForAnchor(anchorDay);
  const todayDay = easternDayNumber(now);
  const weekDays = buildWeekDays(range, todayDay);

  // Exact [start, end) instants for the visible week (Eastern midnights).
  const windowStart = easternMidnightInstant(range.startDay);
  const windowEnd = easternMidnightInstant(range.endDay + 1);

  let laidOut: LaidOutBar[] = [];
  let loadError: string | null = null;
  try {
    const { rows, items, groupTitles } = await loadCalendarData(windowStart, windowEnd);
    const bars = buildCalendarBars(rows, items, groupTitles);
    laidOut = bars
      .map((bar): LaidOutBar | null => {
        const placement = placeInWeek(bar, range);
        if (!placement) return null;
        return { bar, placement };
      })
      .filter((b): b is LaidOutBar => b !== null)
      .sort(sortForRender);
  } catch {
    loadError =
      "Could not load reservations. Check the database connection and try again.";
  }

  const rangeLabel = `${rangeFmt.format(easternMidnightInstant(range.startDay))} – ${rangeFmt.format(
    easternMidnightInstant(range.endDay),
  )}`;

  return (
    <main className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.title}>
          Calendar
          <span className={styles.rangeLabel}>{rangeLabel}</span>
        </h1>
        <Link
          className={styles.navBtn}
          href={`/calendar?week=${prevWeekIso(range)}`}
          aria-label="Previous week"
        >
          ‹ Prev
        </Link>
        <Link className={styles.navBtn} href="/calendar" aria-label="Current week">
          Today
        </Link>
        <Link
          className={styles.navBtn}
          href={`/calendar?week=${nextWeekIso(range)}`}
          aria-label="Next week"
        >
          Next ›
        </Link>
        <Link
          className={styles.addBtn}
          href={ADD_RESERVATION_HREF}
          aria-label="Add reservation"
          title="Add reservation"
        >
          +
        </Link>
      </div>

      <div className={styles.weekHeader}>
        {weekDays.map((d) => (
          <div
            key={d.iso}
            className={`${styles.dayHead} ${d.isToday ? styles.today : ""}`}
          >
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
          const title = [
            `${bar.label} — ${statusLabel(bar.status)}`,
            bar.itemNames.length > 0 ? `Items: ${bar.itemNames.join(", ")}` : null,
            `${dateTimeFmt.format(bar.start_at)} → ${dateTimeFmt.format(bar.end_at)}`,
            bar.customerName ? `Contact: ${bar.customerName}` : null,
            bar.notes ? `Notes: ${bar.notes}` : null,
          ]
            .filter(Boolean)
            .join("\n");
          // Bars with a group_id link to the Edit Reservation page (P6.2); it
          // now represents N rows instead of 1. Storefront confirmed rows may
          // have no group — those stay non-clickable. Same rendered box either way.
          const barProps = {
            className: `${styles.bar} ${statusClass(bar.status)}`,
            style: {
              gridColumn: `${placement.startCol + 1} / ${placement.endCol + 2}`,
              gridRow: index + 1,
            },
            title,
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
