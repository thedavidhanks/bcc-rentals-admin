// Month-grid date math (execution-plan task P11.5). A PURE module (no DB, no
// secrets, no `import "server-only"`, no Next.js APIs) — see
// tests/calendar-month.test.ts.
//
// The key simplification (work order §3.3): a visible month grid is just N
// stacked week rows — the same 7-column `WeekRange` the week view already
// renders. So this module answers exactly one question — which `WeekRange`s
// make up the visible grid for the month containing a given anchor day? —
// and reuses `lib/calendar/week.ts`'s `placeInWeek`/`weekStartDay` for
// everything else (multi-day spanning, clipping, continuation arrows) rather
// than writing a second placement algorithm.
//
// Civil-date math only (daysFromCivil/civilFromDays, from
// lib/scheduler/recurrence.ts) — never raw millisecond arithmetic. See
// lib/calendar/week.ts:239-247 for why that matters (DST).

import {
  civilFromDays,
  daysFromCivil,
  formatDays,
  weekdayFromDays,
} from "@/lib/scheduler/recurrence";

import { DAYS_PER_WEEK, weekStartDay, type WeekRange } from "./week";

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** The visible grid for one calendar month: 4-6 Sunday-first week rows. */
export interface MonthGrid {
  /** Day number of the 1st of the displayed month. */
  monthStartDay: number;
  /** Day number of the last day of the displayed month. */
  monthEndDay: number;
  /** Sunday-first week rows covering the whole visible grid, including the
   *  leading/trailing fill days borrowed from the adjacent months. */
  weeks: WeekRange[];
  /** e.g. "July 2026". */
  label: string;
}

/** Max stacked bar rows per day cell in month view before "+N more" (work
 *  order §3.3 judgment call §4.4 — named constant, not perf-tuned). */
export const MONTH_DAY_OVERFLOW_CAP = 3;

/** The visible month grid containing `anchorDay` (work order §3.3). */
export function monthGridForAnchor(anchorDay: number): MonthGrid {
  const { y, m } = civilFromDays(anchorDay);
  const monthStartDay = daysFromCivil(y, m, 1);
  // daysFromCivil(y, m + 1, 1) is exact even for m=12 -> 13: the algorithm's
  // era/yy shift for m<=2 makes "year y, month 13" and "year y+1, month 1"
  // resolve to the identical day number.
  const monthEndDay = daysFromCivil(y, m + 1, 1) - 1;

  const gridStart = weekStartDay(monthStartDay);
  // Saturday on/after monthEndDay: walk forward to the end of its week.
  const gridEnd = monthEndDay + (DAYS_PER_WEEK - 1 - weekdayFromDays(monthEndDay));

  const weeks: WeekRange[] = [];
  for (let start = gridStart; start <= gridEnd; start += DAYS_PER_WEEK) {
    weeks.push({ startDay: start, endDay: start + DAYS_PER_WEEK - 1 });
  }

  return {
    monthStartDay,
    monthEndDay,
    weeks,
    label: `${MONTH_LABELS[m - 1]} ${y}`,
  };
}

/** `YYYY-MM-DD` of the 1st of the month before the one containing `anchorDay`. */
export function prevMonthIso(anchorDay: number): string {
  const { y, m } = civilFromDays(anchorDay);
  return formatDays(daysFromCivil(y, m - 1, 1));
}

/** `YYYY-MM-DD` of the 1st of the month after the one containing `anchorDay`. */
export function nextMonthIso(anchorDay: number): string {
  const { y, m } = civilFromDays(anchorDay);
  return formatDays(daysFromCivil(y, m + 1, 1));
}
