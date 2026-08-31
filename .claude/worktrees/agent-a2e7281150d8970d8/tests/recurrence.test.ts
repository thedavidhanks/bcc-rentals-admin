import { describe, expect, it } from "vitest";
import {
  expandRecurrence,
  MAX_OCCURRENCES,
  type RecurrenceRule,
} from "../lib/scheduler/recurrence";

// Helper: build a rule with sane defaults, override per test.
function rule(overrides: Partial<RecurrenceRule>): RecurrenceRule {
  return {
    freq: "daily",
    interval: 1,
    startsOn: "2026-01-01",
    count: 3,
    ...overrides,
  };
}

describe("expandRecurrence — daily", () => {
  it("expands a simple daily count", () => {
    const { occurrences, truncated } = expandRecurrence(
      rule({ freq: "daily", interval: 1, count: 4, startsOn: "2026-01-01" }),
    );
    expect(occurrences).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
    ]);
    expect(truncated).toBe(false);
  });

  it("respects interval > 1 (every 3 days)", () => {
    const { occurrences } = expandRecurrence(
      rule({ freq: "daily", interval: 3, count: 4, startsOn: "2026-01-01" }),
    );
    expect(occurrences).toEqual([
      "2026-01-01",
      "2026-01-04",
      "2026-01-07",
      "2026-01-10",
    ]);
  });
});

describe("expandRecurrence — weekly", () => {
  it("lands on specific days_of_week (Mon + Wed) on/after startsOn", () => {
    // 2026-01-01 is a Thursday (weekday 4); byWeekday overrides it.
    const { occurrences } = expandRecurrence(
      rule({
        freq: "weekly",
        interval: 1,
        byWeekday: [1, 3], // Mon, Wed
        startsOn: "2026-01-01",
        count: 4,
      }),
    );
    expect(occurrences).toEqual([
      "2026-01-05", // Mon
      "2026-01-07", // Wed
      "2026-01-12", // Mon
      "2026-01-14", // Wed
    ]);
  });

  it("de-duplicates and sorts an unordered byWeekday", () => {
    const { occurrences } = expandRecurrence(
      rule({
        freq: "weekly",
        interval: 1,
        byWeekday: [3, 1, 1], // dup + unordered → [1,3]
        startsOn: "2026-01-01",
        count: 2,
      }),
    );
    expect(occurrences).toEqual(["2026-01-05", "2026-01-07"]);
  });

  it("defaults byWeekday to the startsOn weekday when null", () => {
    // startsOn Thursday → weekly on Thursdays.
    const { occurrences } = expandRecurrence(
      rule({
        freq: "weekly",
        interval: 1,
        byWeekday: null,
        startsOn: "2026-01-01",
        count: 3,
      }),
    );
    expect(occurrences).toEqual(["2026-01-01", "2026-01-08", "2026-01-15"]);
  });

  it("respects interval > 1 (every 2 weeks on Thursdays)", () => {
    const { occurrences } = expandRecurrence(
      rule({
        freq: "weekly",
        interval: 2,
        byWeekday: [4], // Thu
        startsOn: "2026-01-01",
        count: 3,
      }),
    );
    // Skip the odd weeks: 01-01, 01-15, 01-29.
    expect(occurrences).toEqual(["2026-01-01", "2026-01-15", "2026-01-29"]);
  });
});

describe("expandRecurrence — monthly & yearly", () => {
  it("anchors monthly on the original day-of-month, clamping short months", () => {
    const { occurrences } = expandRecurrence(
      rule({ freq: "monthly", interval: 1, startsOn: "2026-01-31", count: 4 }),
    );
    // Feb clamps to 28 but March returns to 31 (anchored, no drift).
    expect(occurrences).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("respects monthly interval > 1 (every 2 months)", () => {
    const { occurrences } = expandRecurrence(
      rule({ freq: "monthly", interval: 2, startsOn: "2026-01-15", count: 3 }),
    );
    expect(occurrences).toEqual(["2026-01-15", "2026-03-15", "2026-05-15"]);
  });

  it("clamps a Feb-29 yearly rule in non-leap years", () => {
    const { occurrences } = expandRecurrence(
      rule({ freq: "yearly", interval: 1, startsOn: "2024-02-29", count: 3 }),
    );
    expect(occurrences).toEqual(["2024-02-29", "2025-02-28", "2026-02-28"]);
  });
});

describe("expandRecurrence — termination", () => {
  it("terminates on count without truncation", () => {
    const { occurrences, truncated } = expandRecurrence(
      rule({ freq: "daily", interval: 1, count: 10, startsOn: "2026-01-01" }),
    );
    expect(occurrences).toHaveLength(10);
    expect(truncated).toBe(false);
  });

  it("terminates inclusively on untilDate", () => {
    const { occurrences, truncated } = expandRecurrence(
      rule({
        freq: "daily",
        interval: 1,
        count: null,
        untilDate: "2026-01-05",
        startsOn: "2026-01-01",
      }),
    );
    expect(occurrences).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
      "2026-01-05", // inclusive
    ]);
    expect(truncated).toBe(false);
  });

  it("returns an empty, non-truncated result when untilDate precedes startsOn", () => {
    const { occurrences, truncated } = expandRecurrence(
      rule({
        freq: "daily",
        count: null,
        untilDate: "2025-12-31",
        startsOn: "2026-01-01",
      }),
    );
    expect(occurrences).toEqual([]);
    expect(truncated).toBe(false);
  });
});

describe("expandRecurrence — caps & truncation signal", () => {
  it("caps at the default MAX_OCCURRENCES and flags truncation", () => {
    const { occurrences, truncated } = expandRecurrence(
      rule({ freq: "daily", interval: 1, count: 500, startsOn: "2026-01-01" }),
    );
    expect(occurrences).toHaveLength(MAX_OCCURRENCES);
    expect(truncated).toBe(true);
  });

  it("caps at a custom maxOccurrences and flags truncation", () => {
    const { occurrences, truncated } = expandRecurrence(
      rule({ freq: "daily", interval: 1, count: 100, startsOn: "2026-01-01" }),
      { maxOccurrences: 5 },
    );
    expect(occurrences).toHaveLength(5);
    expect(truncated).toBe(true);
  });

  it("does not flag truncation when count is within the cap", () => {
    const { occurrences, truncated } = expandRecurrence(
      rule({ freq: "daily", interval: 1, count: 5, startsOn: "2026-01-01" }),
      { maxOccurrences: 10 },
    );
    expect(occurrences).toHaveLength(5);
    expect(truncated).toBe(false);
  });

  it("caps at the horizonDays window (inclusive) and flags truncation", () => {
    const { occurrences, truncated } = expandRecurrence(
      rule({ freq: "daily", interval: 1, count: 100, startsOn: "2026-01-01" }),
      { horizonDays: 9 },
    );
    // Inclusive: startsOn + 9 days = 2026-01-10, so 10 occurrences.
    expect(occurrences).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
      "2026-01-08",
      "2026-01-09",
      "2026-01-10",
    ]);
    expect(truncated).toBe(true);
  });

  it("does not truncate when the rule ends inside the horizon window", () => {
    const { occurrences, truncated } = expandRecurrence(
      rule({ freq: "daily", interval: 1, count: 5, startsOn: "2026-01-01" }),
      { horizonDays: 30 },
    );
    expect(occurrences).toHaveLength(5);
    expect(truncated).toBe(false);
  });
});

describe("expandRecurrence — DST edges (dates stay stable civil dates)", () => {
  it("spans the US spring-forward boundary without skipping a day", () => {
    // 2026-03-08 02:00 is the spring-forward instant in America/New_York.
    const { occurrences } = expandRecurrence(
      rule({ freq: "daily", interval: 1, count: 4, startsOn: "2026-03-07" }),
    );
    expect(occurrences).toEqual([
      "2026-03-07",
      "2026-03-08", // DST begins — still a normal calendar day
      "2026-03-09",
      "2026-03-10",
    ]);
  });

  it("spans the US fall-back boundary without duplicating a day", () => {
    // 2026-11-01 02:00 is the fall-back instant in America/New_York.
    const { occurrences } = expandRecurrence(
      rule({ freq: "daily", interval: 1, count: 4, startsOn: "2026-10-31" }),
    );
    expect(occurrences).toEqual([
      "2026-10-31",
      "2026-11-01", // DST ends — still a single calendar day
      "2026-11-02",
      "2026-11-03",
    ]);
  });

  it("keeps weekly steps stable across a DST boundary (exactly 7 civil days)", () => {
    const { occurrences } = expandRecurrence(
      rule({
        freq: "weekly",
        interval: 1,
        byWeekday: null,
        startsOn: "2026-03-05", // Thursday, before spring-forward
        count: 3,
      }),
    );
    expect(occurrences).toEqual(["2026-03-05", "2026-03-12", "2026-03-19"]);
  });
});

describe("expandRecurrence — validation", () => {
  it("rejects an unknown frequency", () => {
    expect(() =>
      // @ts-expect-error intentionally invalid freq
      expandRecurrence(rule({ freq: "fortnightly" })),
    ).toThrow(/Unknown recurrence freq/);
  });

  it("rejects a non-positive interval", () => {
    expect(() => expandRecurrence(rule({ interval: 0 }))).toThrow(/interval/);
  });

  it("rejects a rule with neither count nor untilDate", () => {
    expect(() =>
      expandRecurrence(rule({ count: null, untilDate: null })),
    ).toThrow(/terminate/);
  });

  it("rejects an out-of-range byWeekday", () => {
    expect(() =>
      expandRecurrence(rule({ freq: "weekly", byWeekday: [7] })),
    ).toThrow(/byWeekday/);
  });

  it("rejects a malformed startsOn", () => {
    expect(() => expandRecurrence(rule({ startsOn: "01/01/2026" }))).toThrow(
      /startsOn/,
    );
  });

  it("rejects an impossible calendar date", () => {
    expect(() => expandRecurrence(rule({ startsOn: "2026-02-30" }))).toThrow(
      /day-of-month/,
    );
  });
});
