// Weekly-calendar date math (execution-plan task P5.2).
//
// A PURE module (no DB, no secrets, no `import "server-only"`) so it is unit-
// testable and importable from both the server calendar page and, later, client
// previews. It answers two questions the weekly view needs:
//
//   1. Which 7 Eastern calendar days make up the week containing a given date?
//   2. For a reservation whose start_at/end_at are real instants (timestamptz →
//      JS Date), which day COLUMNS of that week does it span, and does it
//      continue past either edge of the week?
//
// Time convention (CLAUDE.md / spec §2, §9): reservation instants are converted
// to `America/New_York` civil dates ONLY here, for placement/display. We never
// store or reason about UTC offsets in the row data. All week/column arithmetic
// runs on timezone-free civil day numbers (proleptic Gregorian), so it is
// DST-proof by construction — a booking that spans the spring-forward or
// fall-back Sunday still lands on consecutive day columns with no gaps.
//
// The civil-date primitives (daysFromCivil / civilFromDays / weekdayFromDays /
// formatDays / parseDateToDays) are reused from lib/scheduler/recurrence.ts
// rather than duplicated. TODO(P9): when the shared package lands, these civil
// helpers move there and both modules import them from it.

import {
  civilFromDays,
  daysFromCivil,
  formatDays,
  parseDateToDays,
  weekdayFromDays,
} from "@/lib/scheduler/recurrence";

/** BCC operates in Eastern time; day columns are Eastern wall-clock days. */
export const BCC_TIMEZONE = "America/New_York";

/** Number of day columns in the weekly view (Sun..Sat). */
export const DAYS_PER_WEEK = 7;

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** One day column in the weekly grid. */
export interface WeekDay {
  /** Days since 1970-01-01 for this Eastern civil date. */
  dayNumber: number;
  /** Eastern civil date, `YYYY-MM-DD`. */
  iso: string;
  /** `0=Sun..6=Sat` (matches the column index within the week). */
  weekday: number;
  /** Short label, e.g. "Mon". */
  label: string;
  /** Day-of-month, 1..31. */
  dayOfMonth: number;
  /** True when this column is the current Eastern day. */
  isToday: boolean;
}

/** Inclusive range of Eastern civil day numbers covering one visible week. */
export interface WeekRange {
  /** Sunday of the week (day number). */
  startDay: number;
  /** Saturday of the week (day number) = startDay + 6. */
  endDay: number;
}

/** A reservation's placement within a visible week. */
export interface PlacedBar {
  /** Left-most covered column, 0 (Sun) .. 6 (Sat), inclusive. */
  startCol: number;
  /** Right-most covered column, 0..6, inclusive. */
  endCol: number;
  /** True when the reservation began before this week (render a `<`). */
  continuesBefore: boolean;
  /** True when the reservation runs into a later week (render a `>`). */
  continuesAfter: boolean;
}

/** The minimal reservation shape the layout needs (real instants). */
export interface HasInstantWindow {
  start_at: Date;
  end_at: Date;
}

// ---------------------------------------------------------------------------
// Eastern instant → civil day number
// ---------------------------------------------------------------------------

/** The Eastern civil (y, m, d) an instant falls on. */
export function easternYmd(instant: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BCC_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** Day number (days since 1970-01-01) of the Eastern civil date for an instant. */
export function easternDayNumber(instant: Date): number {
  const { y, m, d } = easternYmd(instant);
  return daysFromCivil(y, m, d);
}

/** UTC minutes east of the given IANA zone at `instant` (positive = ahead of UTC). */
function zoneOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BCC_TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUTC = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return (asUTC - instant.getTime()) / 60_000;
}

/**
 * The real instant of Eastern local midnight (00:00) starting the given civil
 * day number. Used to build the exact [start, end) window handed to the
 * range query. Eastern DST transitions happen at 02:00, never midnight, so a
 * single offset correction is exact.
 */
export function easternMidnightInstant(dayNumber: number): Date {
  const { y, m, d } = civilFromDays(dayNumber);
  const utcGuess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offset = zoneOffsetMinutes(new Date(utcGuess));
  return new Date(utcGuess - offset * 60_000);
}

/**
 * The real instant of an Eastern wall-clock time given as (civil date,
 * minutes-since-local-midnight). This is the correct way to turn the admin
 * booking domain — a civil Eastern date + minutes since midnight (spec §2) —
 * into a `timestamptz` instant.
 *
 * Why not `easternMidnightInstant(day) + minutes*60000`: that is wrong across
 * the spring-forward Sunday. Eastern shifts UTC−05:00 → UTC−04:00 at 02:00
 * local, so the calendar day is not a uniform 24 hours (it is 23h that day, and
 * 25h on fall-back). Adding raw milliseconds to midnight ignores that the offset
 * an hour later differs, landing on the wrong instant for any wall-clock time at
 * or past the transition.
 *
 * Instead we mirror `easternMidnightInstant`'s offset-correction technique but
 * evaluate the offset at the requested wall-clock time: form the UTC "guess" for
 * that exact wall-clock (as if it were UTC), read Eastern's offset at the guess,
 * and correct once. Because the offset at the guess equals the offset actually in
 * effect at that wall-clock time (except within the one nonexistent spring-forward
 * hour, where either offset yields the standard forward-shift resolution), a
 * single correction is exact.
 *
 * @param dateOrDayNumber a civil day number (days since 1970-01-01) OR a
 *        `YYYY-MM-DD` Eastern civil date string.
 * @param minutes minutes since Eastern local midnight (0..1440).
 */
export function easternInstant(dateOrDayNumber: number | string, minutes: number): Date {
  const dayNumber =
    typeof dateOrDayNumber === "number"
      ? dateOrDayNumber
      : parseDateToDays(dateOrDayNumber, "date");
  const { y, m, d } = civilFromDays(dayNumber);
  // The requested wall-clock time expressed as if it were UTC.
  const utcGuess = Date.UTC(y, m - 1, d, 0, 0, 0) + minutes * 60_000;
  const offset = zoneOffsetMinutes(new Date(utcGuess));
  return new Date(utcGuess - offset * 60_000);
}

// ---------------------------------------------------------------------------
// Week construction
// ---------------------------------------------------------------------------

/** Sunday (day number) of the week containing `dayNumber`. */
export function weekStartDay(dayNumber: number): number {
  return dayNumber - weekdayFromDays(dayNumber);
}

/**
 * Resolve the anchor day number for the view: a valid `?week=YYYY-MM-DD` param,
 * else the Eastern day for `now`. Invalid input falls back to today so a
 * mistyped URL never errors the page.
 */
export function resolveAnchorDay(weekParam: string | undefined, now: Date): number {
  if (weekParam) {
    try {
      return parseDateToDays(weekParam, "week");
    } catch {
      // fall through to "today"
    }
  }
  return easternDayNumber(now);
}

/** The inclusive Eastern day-number range for the week containing the anchor. */
export function weekRangeForAnchor(anchorDay: number): WeekRange {
  const startDay = weekStartDay(anchorDay);
  return { startDay, endDay: startDay + DAYS_PER_WEEK - 1 };
}

/** Build the 7 Sunday-first day columns for a week, flagging the current day. */
export function buildWeekDays(range: WeekRange, todayDay: number): WeekDay[] {
  const days: WeekDay[] = [];
  for (let i = 0; i < DAYS_PER_WEEK; i++) {
    const dayNumber = range.startDay + i;
    const { d } = civilFromDays(dayNumber);
    days.push({
      dayNumber,
      iso: formatDays(dayNumber),
      weekday: i,
      label: WEEKDAY_LABELS[i],
      dayOfMonth: d,
      isToday: dayNumber === todayDay,
    });
  }
  return days;
}

/** `YYYY-MM-DD` for `?week=` links: the previous / next week's Sunday. */
export function prevWeekIso(range: WeekRange): string {
  return formatDays(range.startDay - DAYS_PER_WEEK);
}
export function nextWeekIso(range: WeekRange): string {
  return formatDays(range.startDay + DAYS_PER_WEEK);
}

// ---------------------------------------------------------------------------
// Reservation → column span
// ---------------------------------------------------------------------------

/**
 * Place a reservation's [start_at, end_at) instant window onto the visible week's
 * day columns. Returns `null` when the reservation does not intersect the week.
 *
 * Half-open semantics (spec §8): a booking that ends exactly at Eastern midnight
 * does NOT occupy that final day — Mon 00:00 → Wed 00:00 covers Mon+Tue only.
 * We take the last covered day from the instant one millisecond before end_at,
 * which folds the exactly-midnight case onto the previous day correctly.
 */
export function placeInWeek(
  reservation: HasInstantWindow,
  range: WeekRange,
): PlacedBar | null {
  const firstDay = easternDayNumber(reservation.start_at);
  const endMs = reservation.end_at.getTime();
  // Guard against non-positive windows (shouldn't happen; end > start by
  // constraint) so lastDay is never before firstDay.
  const lastInstant =
    endMs > reservation.start_at.getTime()
      ? new Date(endMs - 1)
      : reservation.start_at;
  const lastDay = Math.max(firstDay, easternDayNumber(lastInstant));

  // No intersection with this week.
  if (lastDay < range.startDay || firstDay > range.endDay) return null;

  const startCol = Math.max(firstDay, range.startDay) - range.startDay;
  const endCol = Math.min(lastDay, range.endDay) - range.startDay;

  return {
    startCol,
    endCol,
    continuesBefore: firstDay < range.startDay,
    continuesAfter: lastDay > range.endDay,
  };
}
