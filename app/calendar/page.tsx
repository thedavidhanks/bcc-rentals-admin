import Link from "next/link";

import { requireScheduler } from "@/lib/auth/guards";
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

interface WeekData {
  reservations: ReservationRow[];
  itemNames: Map<string, string>;
}

async function loadWeekData(start: Date, end: Date): Promise<WeekData> {
  // Imported lazily so `next build` (which runs without DATABASE_URL) does not
  // evaluate lib/env's boot-time validation. At request time env is present.
  const [{ listReservationsInRange }, { listItems }] = await Promise.all([
    import("@/lib/repositories/reservations"),
    import("@/lib/repositories/items"),
  ]);

  const [reservations, items] = await Promise.all([
    // Include cancelled so they can be greyed out (spec §9).
    listReservationsInRange(start, end, { includeCancelled: true }),
    listItems(),
  ]);

  const itemNames = new Map(items.map((i) => [i.id, i.name]));
  return { reservations, itemNames };
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

/** A reservation resolved to a week placement, ready to render. */
interface LaidOutBar {
  reservation: ReservationRow;
  bar: PlacedBar;
  itemName: string;
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

  let bars: LaidOutBar[] = [];
  let loadError: string | null = null;
  try {
    const { reservations, itemNames } = await loadWeekData(windowStart, windowEnd);
    bars = reservations
      .map((reservation): LaidOutBar | null => {
        const bar = placeInWeek(reservation, range);
        if (!bar) return null;
        return {
          reservation,
          bar,
          itemName: itemNames.get(reservation.item_id) ?? "Unknown item",
        };
      })
      .filter((b): b is LaidOutBar => b !== null)
      // Active bars first, then left-to-right, then earliest start.
      .sort((a, b) => {
        const ac = a.reservation.status === "cancelled" ? 1 : 0;
        const bc = b.reservation.status === "cancelled" ? 1 : 0;
        if (ac !== bc) return ac - bc;
        if (a.bar.startCol !== b.bar.startCol) return a.bar.startCol - b.bar.startCol;
        return a.reservation.start_at.getTime() - b.reservation.start_at.getTime();
      });
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
        {bars.length === 0 && !loadError && (
          <p className={styles.empty}>No reservations this week.</p>
        )}
        {bars.map(({ reservation, bar, itemName }, index) => {
          const title = [
            `${itemName} — ${statusLabel(reservation.status)}`,
            `${dateTimeFmt.format(reservation.start_at)} → ${dateTimeFmt.format(reservation.end_at)}`,
            reservation.customer_name ? `Contact: ${reservation.customer_name}` : null,
            reservation.notes ? `Notes: ${reservation.notes}` : null,
          ]
            .filter(Boolean)
            .join("\n");
          // Bars with a group_id link to the Edit Reservation page (P6.2);
          // storefront confirmed rows may have no group — those stay
          // non-clickable. The rendered box is identical either way.
          const barProps = {
            className: `${styles.bar} ${statusClass(reservation.status)}`,
            style: {
              gridColumn: `${bar.startCol + 1} / ${bar.endCol + 2}`,
              gridRow: index + 1,
            },
            title,
          };
          const barBody = (
            <>
              {bar.continuesBefore && (
                <span className={styles.cont} aria-label="continues from previous week">
                  ‹
                </span>
              )}
              <span className={styles.barLabel}>
                {itemName}
                {reservation.customer_name ? ` · ${reservation.customer_name}` : ""}
              </span>
              <span className={styles.barMeta}>{statusLabel(reservation.status)}</span>
              {bar.continuesAfter && (
                <span className={styles.cont} aria-label="continues into next week">
                  ›
                </span>
              )}
            </>
          );
          return reservation.group_id ? (
            <Link
              key={reservation.id}
              href={`/reservations/${reservation.group_id}`}
              {...barProps}
            >
              {barBody}
            </Link>
          ) : (
            <div key={reservation.id} {...barProps}>
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
