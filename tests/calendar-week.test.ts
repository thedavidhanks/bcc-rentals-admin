import { describe, expect, it } from "vitest";

import {
  buildWeekDays,
  easternDayNumber,
  easternInstant,
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

describe("easternInstant (Eastern civil date + minutes → real instant)", () => {
  it("converts a summer (EDT, -04:00) wall-clock time correctly", () => {
    // 2026-08-02 09:00 America/New_York (EDT) = 13:00 UTC.
    const inst = easternInstant("2026-08-02", 9 * 60);
    expect(inst.toISOString()).toBe("2026-08-02T13:00:00.000Z");
  });

  it("converts a winter (EST, -05:00) wall-clock time correctly", () => {
    // 2026-01-15 09:00 America/New_York (EST) = 14:00 UTC.
    const inst = easternInstant("2026-01-15", 9 * 60);
    expect(inst.toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });

  it("accepts a day number as well as a YYYY-MM-DD string", () => {
    const byString = easternInstant("2026-08-02", 9 * 60);
    const byNumber = easternInstant(daysFromCivil(2026, 8, 2), 9 * 60);
    expect(byNumber.toISOString()).toBe(byString.toISOString());
  });

  it("agrees with easternMidnightInstant at 00:00", () => {
    const dn = daysFromCivil(2026, 8, 2);
    expect(easternInstant(dn, 0).toISOString()).toBe(
      easternMidnightInstant(dn).toISOString(),
    );
  });

  // ---- DST boundary: SPRING-FORWARD (2026-03-08, 02:00 EST → 03:00 EDT) ----
  it("is offset-correct straddling spring-forward (would be wrong via midnight+ms)", () => {
    // Before the 02:00 gap: 01:30 EST (-05:00) = 06:30 UTC.
    expect(easternInstant("2026-03-08", 1 * 60 + 30).toISOString()).toBe(
      "2026-03-08T06:30:00.000Z",
    );
    // After the gap: 09:00 EDT (-04:00) = 13:00 UTC. The naive
    // "midnight instant + 9h" would give 14:00Z (using the pre-transition
    // -05:00 offset), i.e. one hour off — this must be 13:00Z.
    const afterGap = easternInstant("2026-03-08", 9 * 60);
    expect(afterGap.toISOString()).toBe("2026-03-08T13:00:00.000Z");

    const naiveWrong = new Date(
      easternMidnightInstant(daysFromCivil(2026, 3, 8)).getTime() + 9 * 60 * 60_000,
    );
    expect(naiveWrong.toISOString()).toBe("2026-03-08T14:00:00.000Z");
    expect(afterGap.toISOString()).not.toBe(naiveWrong.toISOString());
  });

  // ---- DST boundary: FALL-BACK (2026-11-01, 02:00 EDT → 01:00 EST) ----
  it("is offset-correct straddling fall-back", () => {
    // Before the fall-back at 02:00: 00:30 EDT (-04:00) = 04:30 UTC.
    expect(easternInstant("2026-11-01", 30).toISOString()).toBe(
      "2026-11-01T04:30:00.000Z",
    );
    // After fall-back: 09:00 EST (-05:00) = 14:00 UTC.
    const afterFallback = easternInstant("2026-11-01", 9 * 60);
    expect(afterFallback.toISOString()).toBe("2026-11-01T14:00:00.000Z");

    // A whole 24h day (fall-back) is 25 real hours: midnight+9h via ms would use
    // the -04:00 offset and give 13:00Z, one hour off the correct 14:00Z.
    const naiveWrong = new Date(
      easternMidnightInstant(daysFromCivil(2026, 11, 1)).getTime() + 9 * 60 * 60_000,
    );
    expect(naiveWrong.toISOString()).toBe("2026-11-01T13:00:00.000Z");
    expect(afterFallback.toISOString()).not.toBe(naiveWrong.toISOString());
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
