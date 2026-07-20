// Recurrence expansion (execution-plan task P2.4).
//
// A PURE function that expands a `reservation_series` rule (spec §5) into an
// ordered list of concrete occurrence DATES in the `America/New_York` timezone,
// plus an explicit truncation signal (spec §9: "never silently drop occurrences").
//
// Why no `import "server-only"`: this module touches no DB and no secrets — it is
// pure calendar arithmetic and is deliberately importable from both server and
// client code (e.g. to preview a recurrence in the Add Reservation UI, spec §7).
//
// Time convention (CLAUDE.md / spec §2): occurrence dates are *civil* Eastern
// calendar dates with NO stored UTC offset. We therefore do all arithmetic on the
// proleptic-Gregorian calendar (year/month/day and integer day numbers), never on
// JS `Date` instants. This makes the result DST-proof by construction: a civil date
// has no notion of daylight-saving time, so a daily rule that steps across the US
// spring-forward (2nd Sunday of March) or fall-back (1st Sunday of November)
// boundary yields consecutive calendar dates with no skips and no duplicates.
//
// This is an admin-only concept (the storefront has no recurring bookings), so
// there is no storefront implementation to mirror — nothing here is a `TODO(P9)`
// copy. The generic civil-date helpers below are candidates to live in the shared
// package eventually, but they are not duplicated from anywhere today.

/** Recurrence frequency — mirrors `reservation_series.freq` (spec §5). */
export type RecurrenceFreq = "daily" | "weekly" | "monthly" | "yearly";

/**
 * A recurrence rule, shaped after the `reservation_series` row (spec §5).
 * All dates are Eastern civil dates in `YYYY-MM-DD` form (no time, no offset).
 */
export interface RecurrenceRule {
  /** How the rule repeats. */
  freq: RecurrenceFreq;
  /** "every X" → interval = X. Must be an integer ≥ 1. */
  interval: number;
  /**
   * Weekly-only: which weekdays to land on, `0=Sun..6=Sat` (matches JS
   * `getDay()` / PG `EXTRACT(DOW)`). `null`/omitted/empty ⇒ use the weekday of
   * `startsOn`. Ignored for non-weekly frequencies.
   */
  byWeekday?: number[] | null;
  /** First occurrence date (inclusive), Eastern, `YYYY-MM-DD`. */
  startsOn: string;
  /** Inclusive end date, Eastern, `YYYY-MM-DD`. Provide this OR `count`. */
  untilDate?: string | null;
  /** Maximum number of occurrences. Provide this OR `untilDate`. Integer ≥ 1. */
  count?: number | null;
}

/** Options controlling how far expansion runs before it is capped. */
export interface ExpandOptions {
  /**
   * Cap occurrences to within `horizonDays` days of `startsOn` (inclusive), e.g.
   * the item's `horizon_days` (spec §4/§9). Hitting this cap sets `truncated`.
   */
  horizonDays?: number | null;
  /**
   * Hard ceiling on the number of occurrences regardless of the rule. Defaults to
   * {@link MAX_OCCURRENCES}. Hitting this cap sets `truncated`.
   */
  maxOccurrences?: number;
}

/** Result of expanding a rule. */
export interface ExpansionResult {
  /** Ordered (ascending) Eastern occurrence dates, `YYYY-MM-DD`. */
  occurrences: string[];
  /**
   * `true` iff expansion stopped at a cap (`horizonDays` or `maxOccurrences`)
   * before the rule's own end condition (`count` / `untilDate`) was reached, i.e.
   * more occurrences exist than are returned. Never truncate silently — callers
   * must surface this (spec §9).
   */
  truncated: boolean;
}

/**
 * Hard default ceiling on generated occurrences (spec §9: "a hard max like 104").
 * 104 ≈ two years of weekly bookings.
 */
export const MAX_OCCURRENCES = 104;

// ---------------------------------------------------------------------------
// Timezone-free civil-date helpers (proleptic Gregorian).
// Ported from Howard Hinnant's public-domain `chrono`-compatible algorithms
// (http://howardhinnant.github.io/date_algorithms.html). Day number 0 is
// 1970-01-01; the epoch weekday is Thursday. Pure integer math — no `Date`,
// no timezone, so nothing here is affected by DST.
// ---------------------------------------------------------------------------

interface Ymd {
  y: number;
  m: number; // 1..12
  d: number; // 1..31
}

/** Days from 1970-01-01 for a civil (y, m, d). */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = y - (m <= 2 ? 1 : 0);
  const era = Math.floor((yy >= 0 ? yy : yy - 399) / 400);
  const yoe = yy - era * 400; // [0, 399]
  const doy = Math.trunc((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1; // [0, 365]
  const doe = yoe * 365 + Math.trunc(yoe / 4) - Math.trunc(yoe / 100) + doy; // [0, 146096]
  return era * 146097 + doe - 719468;
}

/** Civil (y, m, d) for a day number counted from 1970-01-01. */
function civilFromDays(z: number): Ymd {
  const zz = z + 719468;
  const era = Math.floor((zz >= 0 ? zz : zz - 146096) / 146097);
  const doe = zz - era * 146097; // [0, 146096]
  const yoe = Math.trunc(
    (doe - Math.trunc(doe / 1460) + Math.trunc(doe / 36524) - Math.trunc(doe / 146096)) / 365,
  ); // [0, 399]
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.trunc(yoe / 4) - Math.trunc(yoe / 100)); // [0, 365]
  const mp = Math.trunc((5 * doy + 2) / 153); // [0, 11]
  const d = doy - Math.trunc((153 * mp + 2) / 5) + 1; // [1, 31]
  const m = mp < 10 ? mp + 3 : mp - 9; // [1, 12]
  return { y: y + (m <= 2 ? 1 : 0), m, d };
}

/** Weekday of a day number, `0=Sun..6=Sat`. */
function weekdayFromDays(z: number): number {
  return ((z % 7) + 4 + 7) % 7; // 1970-01-01 (day 0) is Thursday(4)
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  switch (m) {
    case 2:
      return isLeapYear(y) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse `YYYY-MM-DD` to a day number, validating the calendar date. */
function parseDateToDays(value: string, field: string): number {
  const match = DATE_RE.exec(value);
  if (!match) {
    throw new Error(`${field} must be a YYYY-MM-DD date, got: ${JSON.stringify(value)}`);
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12) {
    throw new Error(`${field} has an invalid month: ${value}`);
  }
  if (d < 1 || d > daysInMonth(y, m)) {
    throw new Error(`${field} has an invalid day-of-month: ${value}`);
  }
  return daysFromCivil(y, m, d);
}

/** Format a day number as `YYYY-MM-DD`. */
function formatDays(z: number): string {
  const { y, m, d } = civilFromDays(z);
  const yyyy = String(y).padStart(4, "0");
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Add `months` calendar months to a day number, anchoring on `anchorDay`
 * (the original day-of-month) and clamping to the target month's length so that
 * e.g. Jan 31 → Feb 28/29 → Mar 31 (anchored on 31, not carried as 28).
 */
function addMonthsAnchored(baseYmd: Ymd, monthsToAdd: number, anchorDay: number): number {
  const totalMonthIndex = baseYmd.y * 12 + (baseYmd.m - 1) + monthsToAdd;
  const y = Math.floor(totalMonthIndex / 12);
  const m = (totalMonthIndex % 12) + 1;
  const d = Math.min(anchorDay, daysInMonth(y, m));
  return daysFromCivil(y, m, d);
}

/**
 * Add `years` calendar years to (year, month, anchorDay), clamping Feb 29 → Feb 28
 * in non-leap target years.
 */
function addYearsAnchored(baseYmd: Ymd, yearsToAdd: number, anchorDay: number): number {
  const y = baseYmd.y + yearsToAdd;
  const d = Math.min(anchorDay, daysInMonth(y, baseYmd.m));
  return daysFromCivil(y, baseYmd.m, d);
}

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

/**
 * Yield candidate occurrence day numbers in strictly ascending order, without any
 * end/cap logic. The consumer ({@link expandRecurrence}) applies count/until and
 * the horizon/max caps. A generator keeps memory flat and lets the consumer stop
 * early. `safetyLimit` bounds the *emitted* candidates so a caller that forgets an
 * end condition still terminates.
 */
function* generateCandidates(
  rule: RecurrenceRule,
  startDay: number,
  safetyLimit: number,
): Generator<number> {
  const interval = rule.interval;
  let emitted = 0;

  if (rule.freq === "daily") {
    for (let day = startDay; emitted < safetyLimit; day += interval, emitted++) {
      yield day;
    }
    return;
  }

  if (rule.freq === "weekly") {
    const startWeekday = weekdayFromDays(startDay);
    const byDays =
      rule.byWeekday && rule.byWeekday.length > 0
        ? [...new Set(rule.byWeekday)].sort((a, b) => a - b)
        : [startWeekday];
    // Sunday (day number) of the week containing startsOn; weeks advance by
    // `interval` weeks so only active weeks are visited.
    const startWeekSunday = startDay - startWeekday;
    for (let weekSunday = startWeekSunday; emitted < safetyLimit; weekSunday += 7 * interval) {
      for (const wd of byDays) {
        const day = weekSunday + wd;
        if (day < startDay) continue; // skip days before the first occurrence
        yield day;
        if (++emitted >= safetyLimit) return;
      }
    }
    return;
  }

  // monthly / yearly: anchor on the original day-of-month so clamping never drifts.
  const startYmd = civilFromDays(startDay);
  const anchorDay = startYmd.d;
  if (rule.freq === "monthly") {
    for (let k = 0; emitted < safetyLimit; k++, emitted++) {
      yield addMonthsAnchored(startYmd, k * interval, anchorDay);
    }
    return;
  }
  // yearly
  for (let k = 0; emitted < safetyLimit; k++, emitted++) {
    yield addYearsAnchored(startYmd, k * interval, anchorDay);
  }
}

function assertPositiveInt(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be an integer ≥ 1, got: ${JSON.stringify(value)}`);
  }
}

/**
 * Expand a recurrence rule into an ordered list of concrete Eastern occurrence
 * dates (`YYYY-MM-DD`) plus a truncation flag.
 *
 * Termination:
 *  - `count`      → stop after N occurrences (natural end; `truncated=false`).
 *  - `untilDate`  → stop after the last occurrence ≤ untilDate (natural end).
 *  - `horizonDays`→ stop after the last occurrence within horizonDays of startsOn;
 *                   if that cut the rule short, `truncated=true`.
 *  - `maxOccurrences` (default {@link MAX_OCCURRENCES}) → hard ceiling; if it cut
 *                   the rule short, `truncated=true`.
 *
 * Per the `reservation_series` check constraint (spec §5) a rule must terminate
 * via `count` or `untilDate`; this function enforces that too.
 *
 * @throws if the rule is malformed (bad frequency, interval, dates, weekdays, or
 *         no `count`/`untilDate`).
 */
export function expandRecurrence(rule: RecurrenceRule, options: ExpandOptions = {}): ExpansionResult {
  if (!["daily", "weekly", "monthly", "yearly"].includes(rule.freq)) {
    throw new Error(`Unknown recurrence freq: ${JSON.stringify(rule.freq)}`);
  }
  assertPositiveInt(rule.interval, "interval");

  const hasUntil = rule.untilDate != null;
  const hasCount = rule.count != null;
  if (!hasUntil && !hasCount) {
    throw new Error("Recurrence must terminate: provide untilDate or count.");
  }
  if (hasCount) assertPositiveInt(rule.count as number, "count");

  if (rule.byWeekday) {
    for (const wd of rule.byWeekday) {
      if (!Number.isInteger(wd) || wd < 0 || wd > 6) {
        throw new Error(`byWeekday entries must be integers 0..6, got: ${JSON.stringify(wd)}`);
      }
    }
  }

  const startDay = parseDateToDays(rule.startsOn, "startsOn");
  const untilDay = hasUntil ? parseDateToDays(rule.untilDate as string, "untilDate") : null;
  if (untilDay != null && untilDay < startDay) {
    // untilDate before startsOn ⇒ zero occurrences, but that is a fully-resolved
    // (non-truncated) empty result.
    return { occurrences: [], truncated: false };
  }

  const maxOccurrences = options.maxOccurrences ?? MAX_OCCURRENCES;
  assertPositiveInt(maxOccurrences, "maxOccurrences");

  let horizonDay: number | null = null;
  if (options.horizonDays != null) {
    assertPositiveInt(options.horizonDays, "horizonDays");
    horizonDay = startDay + options.horizonDays; // inclusive window end
  }

  // Safety limit for the generator: never emit more candidates than could possibly
  // be needed. Bounded by count (if any) and the hard max, plus a small margin.
  const safetyLimit = (hasCount ? Math.min(rule.count as number, maxOccurrences) : maxOccurrences) + 1;

  const occurrences: string[] = [];
  let truncated = false;

  for (const day of generateCandidates(rule, startDay, safetyLimit)) {
    // Natural end: satisfied the requested count.
    if (hasCount && occurrences.length >= (rule.count as number)) {
      break;
    }
    // Natural end: past the inclusive until-date.
    if (untilDay != null && day > untilDay) {
      break;
    }
    // Cap: past the horizon window ⇒ there would have been more.
    if (horizonDay != null && day > horizonDay) {
      truncated = true;
      break;
    }
    // Cap: hit the hard ceiling ⇒ there would have been more.
    if (occurrences.length >= maxOccurrences) {
      truncated = true;
      break;
    }
    occurrences.push(formatDays(day));
  }

  return { occurrences, truncated };
}
