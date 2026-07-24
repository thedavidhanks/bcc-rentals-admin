import { describe, expect, it } from "vitest";

import {
  buildWeekDays,
  easternDayNumber,
  easternMidnightInstant,
  easternYmd,
  nextWeekIso,
  placeInWeek,
  prevWeekIso,
  resolveAnchorDay,
  weekRangeForAnchor,
  weekStartDay,
  type WeekRange,
} from "../lib/calendar/week";
import { daysFromCivil, formatDays } from "../lib/scheduler/recurrence";

// A window helper: build a reservation-ish object from two ISO instants.
const win = (startISO: string, endISO: string) => ({
  start_at: new Date(startISO),
  end_at: new Date(endISO),
});

// The week that contains 2026-07-22 (a Wednesday) is Sun 2026-07-19 .. Sat 2026-07-25.
const anchor = daysFromCivil(2026, 7, 22);
const range: WeekRange = weekRangeForAnchor(anchor);

describe("easternYmd / easternDayNumber", () => {
  it("maps a UTC instant to its Eastern calendar day", () => {
    // 2026-07-22T03:30:00Z is 2026-07-21 23:30 EDT — still the 21st in Eastern.
    expect(easternYmd(new Date("2026-07-22T03:30:00Z"))).toEqual({
      y: 2026,
      m: 7,
      d: 21,
    });
    expect(easternDayNumber(new Date("2026-07-22T03:30:00Z"))).toBe(
      daysFromCivil(2026, 7, 21),
    );
  });

  it("maps an afternoon instant to the same Eastern day", () => {
    expect(easternDayNumber(new Date("2026-07-22T18:00:00Z"))).toBe(
      daysFromCivil(2026, 7, 22),
    );
  });
});

describe("easternMidnightInstant", () => {
  it("returns Eastern local midnight as a real UTC instant (EDT, -04:00)", () => {
    const instant = easternMidnightInstant(daysFromCivil(2026, 7, 19));
    // July → EDT → midnight Eastern is 04:00 UTC.
    expect(instant.toISOString()).toBe("2026-07-19T04:00:00.000Z");
  });

  it("handles standard time (EST, -05:00) in January", () => {
    const instant = easternMidnightInstant(daysFromCivil(2026, 1, 15));
    expect(instant.toISOString()).toBe("2026-01-15T05:00:00.000Z");
  });

  it("round-trips: the midnight instant maps back to the same Eastern day", () => {
    const dn = daysFromCivil(2026, 3, 9); // day after US spring-forward
    expect(easternDayNumber(easternMidnightInstant(dn))).toBe(dn);
  });
});

describe("week construction", () => {
  it("weekStartDay lands on the preceding Sunday", () => {
    // 2026-07-22 is a Wednesday → Sunday is 2026-07-19.
    expect(formatDays(weekStartDay(anchor))).toBe("2026-07-19");
    // Given a Sunday, it returns itself.
    expect(formatDays(weekStartDay(daysFromCivil(2026, 7, 19)))).toBe("2026-07-19");
  });

  it("weekRangeForAnchor spans Sun..Sat inclusive", () => {
    expect(formatDays(range.startDay)).toBe("2026-07-19");
    expect(formatDays(range.endDay)).toBe("2026-07-25");
    expect(range.endDay - range.startDay).toBe(6);
  });

  it("buildWeekDays returns 7 Sunday-first columns and flags today", () => {
    const today = daysFromCivil(2026, 7, 22);
    const days = buildWeekDays(range, today);
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ weekday: 0, label: "Sun", dayOfMonth: 19 });
    expect(days[6]).toMatchObject({ weekday: 6, label: "Sat", dayOfMonth: 25 });
    expect(days.filter((d) => d.isToday)).toHaveLength(1);
    expect(days[3]).toMatchObject({ dayOfMonth: 22, isToday: true });
  });

  it("prev/next week iso step by exactly 7 days", () => {
    expect(prevWeekIso(range)).toBe("2026-07-12");
    expect(nextWeekIso(range)).toBe("2026-07-26");
  });
});

describe("resolveAnchorDay", () => {
  it("uses a valid ?week param", () => {
    expect(resolveAnchorDay("2026-07-22", new Date("2020-01-01T00:00:00Z"))).toBe(
      daysFromCivil(2026, 7, 22),
    );
  });

  it("falls back to the Eastern day of now for a missing or bad param", () => {
    const now = new Date("2026-07-22T18:00:00Z");
    expect(resolveAnchorDay(undefined, now)).toBe(daysFromCivil(2026, 7, 22));
    expect(resolveAnchorDay("not-a-date", now)).toBe(daysFromCivil(2026, 7, 22));
  });
});

describe("placeInWeek", () => {
  it("places a single-day booking on one column", () => {
    // Wed 2026-07-22 14:00–16:00 EDT.
    const bar = placeInWeek(win("2026-07-22T18:00:00Z", "2026-07-22T20:00:00Z"), range);
    expect(bar).toEqual({
      startCol: 3,
      endCol: 3,
      continuesBefore: false,
      continuesAfter: false,
    });
  });

  it("spans a multi-day booking across the columns it covers", () => {
    // Mon 2026-07-20 → Wed 2026-07-22 (ends 14:00 Wed) → Mon,Tue,Wed = cols 1..3.
    const bar = placeInWeek(win("2026-07-20T14:00:00Z", "2026-07-22T18:00:00Z"), range);
    expect(bar).toMatchObject({ startCol: 1, endCol: 3 });
    expect(bar?.continuesBefore).toBe(false);
    expect(bar?.continuesAfter).toBe(false);
  });

  it("treats a window ending exactly at Eastern midnight as not covering that day (half-open)", () => {
    // Mon 2026-07-20 00:00 EDT (04:00Z) → Wed 2026-07-22 00:00 EDT (04:00Z).
    // Covers Mon + Tue only (cols 1..2), NOT Wed.
    const bar = placeInWeek(win("2026-07-20T04:00:00Z", "2026-07-22T04:00:00Z"), range);
    expect(bar).toMatchObject({ startCol: 1, endCol: 2 });
  });

  it("sets continuesBefore for a booking starting in the previous week", () => {
    // Sat 2026-07-18 (prev week) → Mon 2026-07-20: clamps left edge to col 0, `<`.
    const bar = placeInWeek(win("2026-07-18T14:00:00Z", "2026-07-20T18:00:00Z"), range);
    expect(bar).toMatchObject({ startCol: 0, endCol: 1, continuesBefore: true, continuesAfter: false });
  });

  it("sets continuesAfter for a booking running into the next week", () => {
    // Fri 2026-07-24 → Mon 2026-07-27 (next week): clamps right edge to col 6, `>`.
    const bar = placeInWeek(win("2026-07-24T14:00:00Z", "2026-07-27T18:00:00Z"), range);
    expect(bar).toMatchObject({ startCol: 5, endCol: 6, continuesBefore: false, continuesAfter: true });
  });

  it("flags both edges for a booking that engulfs the whole week", () => {
    const bar = placeInWeek(win("2026-07-10T12:00:00Z", "2026-08-01T12:00:00Z"), range);
    expect(bar).toEqual({
      startCol: 0,
      endCol: 6,
      continuesBefore: true,
      continuesAfter: true,
    });
  });

  it("returns null for a booking entirely before the week", () => {
    expect(placeInWeek(win("2026-07-10T12:00:00Z", "2026-07-11T12:00:00Z"), range)).toBeNull();
  });

  it("returns null for a booking entirely after the week", () => {
    expect(placeInWeek(win("2026-08-01T12:00:00Z", "2026-08-02T12:00:00Z"), range)).toBeNull();
  });
});
