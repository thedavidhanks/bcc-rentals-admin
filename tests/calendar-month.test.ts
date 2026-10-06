import { describe, expect, it } from "vitest";

import { monthGridForAnchor, nextMonthIso, prevMonthIso } from "../lib/calendar/month";
import { parseCalendarParams } from "../lib/calendar/bars";
import { placeInWeek } from "../lib/calendar/week";
import { daysFromCivil, formatDays } from "../lib/scheduler/recurrence";

describe("monthGridForAnchor", () => {
  it("builds a 5-row grid for a month starting on a Sunday (2026-03: starts Sun, ends Tue)", () => {
    // 2026-03-01 is a Sunday; 2026-03-31 is a Tuesday.
    const grid = monthGridForAnchor(daysFromCivil(2026, 3, 15));
    expect(formatDays(grid.monthStartDay)).toBe("2026-03-01");
    expect(formatDays(grid.monthEndDay)).toBe("2026-03-31");
    expect(grid.label).toBe("March 2026");
    // No leading fill (1st is already Sunday); 4 trailing days (Wed..Sat) to
    // round out the last week -> 31 + 4 = 35 days = 5 weeks.
    expect(grid.weeks).toHaveLength(5);
    expect(formatDays(grid.weeks[0].startDay)).toBe("2026-03-01");
    expect(formatDays(grid.weeks[grid.weeks.length - 1].endDay)).toBe("2026-04-04");
  });

  it("builds a 6-row grid for a month starting on a Saturday (2026-08: starts Sat, ends Mon)", () => {
    // 2026-08-01 is a Saturday; 2026-08-31 is a Monday.
    const grid = monthGridForAnchor(daysFromCivil(2026, 8, 10));
    expect(formatDays(grid.monthStartDay)).toBe("2026-08-01");
    expect(formatDays(grid.monthEndDay)).toBe("2026-08-31");
    // 6 leading fill days (Sun..Fri before the 1st) + 31 + 5 trailing (Tue..Sat)
    // = 42 days = 6 weeks.
    expect(grid.weeks).toHaveLength(6);
    expect(formatDays(grid.weeks[0].startDay)).toBe("2026-07-26");
    expect(formatDays(grid.weeks[grid.weeks.length - 1].endDay)).toBe("2026-09-05");
  });

  it("builds a 4-row grid for a month that starts and ends within complete weeks (2026-02, 28 days, starts Sun)", () => {
    // 2026-02-01 is a Sunday; 2026-02-28 is a Saturday -> exactly 4 whole weeks.
    const grid = monthGridForAnchor(daysFromCivil(2026, 2, 14));
    expect(grid.weeks).toHaveLength(4);
    expect(formatDays(grid.weeks[0].startDay)).toBe("2026-02-01");
    expect(formatDays(grid.weeks[grid.weeks.length - 1].endDay)).toBe("2026-02-28");
  });

  it("every week row is a full 7-day span", () => {
    const grid = monthGridForAnchor(daysFromCivil(2026, 8, 10));
    for (const week of grid.weeks) {
      expect(week.endDay - week.startDay).toBe(6);
    }
  });

  it("a reservation spanning the month boundary appears in the correct week row(s)", () => {
    // 2026-08 grid's last row is 2026-08-30 .. 2026-09-05 (per the test above).
    const grid = monthGridForAnchor(daysFromCivil(2026, 8, 10));
    const lastWeek = grid.weeks[grid.weeks.length - 1];
    // A booking Aug 31 (Mon) -> Sep 2 (Wed), ending exactly at Eastern midnight.
    const bar = {
      start_at: new Date("2026-08-31T04:00:00Z"), // Aug 31 00:00 EDT
      end_at: new Date("2026-09-02T04:00:00Z"), // Sep 2 00:00 EDT (half-open: covers 31, 1 only)
    };
    const placement = placeInWeek(bar, lastWeek);
    expect(placement).not.toBeNull();
    // It should NOT appear in the first week row (entirely in August's tail).
    const firstWeek = grid.weeks[0];
    expect(placeInWeek(bar, firstWeek)).toBeNull();
  });

  it("a reservation entirely in the leading fill days appears in the first week row only", () => {
    const grid = monthGridForAnchor(daysFromCivil(2026, 8, 10));
    const firstWeek = grid.weeks[0]; // 2026-07-26 .. 2026-08-01
    const bar = {
      start_at: new Date("2026-07-27T14:00:00Z"),
      end_at: new Date("2026-07-27T16:00:00Z"),
    };
    expect(placeInWeek(bar, firstWeek)).not.toBeNull();
    expect(placeInWeek(bar, grid.weeks[1])).toBeNull();
  });
});

describe("prevMonthIso / nextMonthIso", () => {
  it("steps across a year boundary (Dec -> Jan, Jan -> Dec)", () => {
    const dec = daysFromCivil(2026, 12, 15);
    expect(nextMonthIso(dec)).toBe("2027-01-01");

    const jan = daysFromCivil(2027, 1, 1);
    expect(prevMonthIso(jan)).toBe("2026-12-01");
  });

  it("steps into a short month correctly (Jan 31 -> Feb)", () => {
    const jan31 = daysFromCivil(2026, 1, 31);
    expect(nextMonthIso(jan31)).toBe("2026-02-01");
  });

  it("steps back from a short month correctly (Mar -> Feb)", () => {
    const mar = daysFromCivil(2026, 3, 10);
    expect(prevMonthIso(mar)).toBe("2026-02-01");
  });

  it("always normalizes to the 1st of the target month, regardless of the anchor's day-of-month", () => {
    expect(nextMonthIso(daysFromCivil(2026, 7, 1))).toBe("2026-08-01");
    expect(nextMonthIso(daysFromCivil(2026, 7, 31))).toBe("2026-08-01");
  });
});

describe("?view= parsing (P11.5, via lib/calendar/bars.ts)", () => {
  it("absent ⇒ week", () => {
    expect(parseCalendarParams({}).view).toBe("week");
  });

  it("'month' ⇒ month", () => {
    expect(parseCalendarParams({ view: "month" }).view).toBe("month");
  });

  it("garbage ⇒ week", () => {
    expect(parseCalendarParams({ view: "nonsense" }).view).toBe("week");
    expect(parseCalendarParams({ view: "Week" }).view).toBe("week");
  });
});
