import { describe, expect, it } from "vitest";

import {
  findBaseRow,
  formatCentsToDollars,
  formatDaysOfWeek,
  formatHourWindow,
  formatMinutesOfDay,
  hasBaseRow,
  isBaseRow,
  parseDollarsToCents,
  validateDaysOfWeek,
  validateHourWindow,
  wouldRemoveBaseRowOnDelete,
  wouldRemoveBaseRowOnUpdate,
} from "../app/prices/pricing";

// P6.3 — pure helper tests (app/prices/pricing.ts). Covers the §4/§6 boundary
// rules directly, independent of the server actions / DB.

// ---------------------------------------------------------------------------
// Money: dollars string -> integer cents (no floating-point drift)
// ---------------------------------------------------------------------------
describe("parseDollarsToCents", () => {
  it("accepts a whole-dollar amount", () => {
    expect(parseDollarsToCents("0")).toBe(0);
    expect(parseDollarsToCents("5")).toBe(500);
  });

  it("accepts 1-2 fractional digits", () => {
    expect(parseDollarsToCents("12.34")).toBe(1234);
    expect(parseDollarsToCents("12.3")).toBe(1230);
    expect(parseDollarsToCents("0.05")).toBe(5);
  });

  it("rejects negative amounts", () => {
    expect(parseDollarsToCents("-1")).toBeNull();
    expect(parseDollarsToCents("-0.50")).toBeNull();
  });

  it("rejects more than 2 fractional digits (no float drift)", () => {
    expect(parseDollarsToCents("1.005")).toBeNull();
    expect(parseDollarsToCents("12.341")).toBeNull();
  });

  it("rejects non-numeric / empty input", () => {
    expect(parseDollarsToCents("")).toBeNull();
    expect(parseDollarsToCents("abc")).toBeNull();
    expect(parseDollarsToCents("$12.34")).toBeNull();
    expect(parseDollarsToCents("12,34")).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(parseDollarsToCents("  12.34  ")).toBe(1234);
  });
});

describe("formatCentsToDollars", () => {
  it("formats whole and fractional cents", () => {
    expect(formatCentsToDollars(0)).toBe("0.00");
    expect(formatCentsToDollars(1234)).toBe("12.34");
    expect(formatCentsToDollars(5)).toBe("0.05");
  });
});

// ---------------------------------------------------------------------------
// days_of_week validation (0=Sun..6=Sat, null = every day)
// ---------------------------------------------------------------------------
describe("validateDaysOfWeek", () => {
  it("null (every day) is always valid", () => {
    expect(validateDaysOfWeek(null)).toBeNull();
  });

  it("accepts unique days within 0..6", () => {
    expect(validateDaysOfWeek([0, 6])).toBeNull();
    expect(validateDaysOfWeek([1, 2, 3, 4, 5])).toBeNull();
  });

  it("rejects an empty array", () => {
    expect(validateDaysOfWeek([])).not.toBeNull();
  });

  it("rejects out-of-range days", () => {
    expect(validateDaysOfWeek([7])).not.toBeNull();
    expect(validateDaysOfWeek([-1])).not.toBeNull();
  });

  it("rejects duplicate days", () => {
    expect(validateDaysOfWeek([1, 1])).not.toBeNull();
  });
});

describe("formatDaysOfWeek", () => {
  it("renders null as every day", () => {
    expect(formatDaysOfWeek(null)).toBe("Every day");
  });

  it("renders a sorted, de-duplicated day list", () => {
    expect(formatDaysOfWeek([6, 0])).toBe("Sun, Sat");
  });
});

// ---------------------------------------------------------------------------
// start_minute/end_minute validation (both-null-or-both-set, 0..1440, end>start)
// ---------------------------------------------------------------------------
describe("validateHourWindow", () => {
  it("both null (all hours) is valid", () => {
    expect(validateHourWindow(null, null)).toBeNull();
  });

  it("both set within bounds and end > start is valid", () => {
    expect(validateHourWindow(540, 1020)).toBeNull();
    expect(validateHourWindow(0, 1440)).toBeNull();
  });

  it("rejects one-set-one-null", () => {
    expect(validateHourWindow(540, null)).not.toBeNull();
    expect(validateHourWindow(null, 1020)).not.toBeNull();
  });

  it("rejects out-of-bounds minutes", () => {
    expect(validateHourWindow(-1, 100)).not.toBeNull();
    expect(validateHourWindow(100, 1441)).not.toBeNull();
  });

  it("rejects end == start and end < start", () => {
    expect(validateHourWindow(540, 540)).not.toBeNull();
    expect(validateHourWindow(600, 540)).not.toBeNull();
  });
});

describe("formatMinutesOfDay / formatHourWindow", () => {
  it("formats minutes as a 12-hour clock label", () => {
    expect(formatMinutesOfDay(540)).toBe("9:00 AM");
    expect(formatMinutesOfDay(0)).toBe("12:00 AM");
    expect(formatMinutesOfDay(720)).toBe("12:00 PM");
    expect(formatMinutesOfDay(1020)).toBe("5:00 PM");
  });

  it("renders null/null as All hours", () => {
    expect(formatHourWindow(null, null)).toBe("All hours");
  });

  it("renders a start-end window", () => {
    expect(formatHourWindow(540, 1020)).toBe("9:00 AM–5:00 PM");
  });
});

// ---------------------------------------------------------------------------
// Base-row logic
// ---------------------------------------------------------------------------
const base = { id: "base", days_of_week: null, start_minute: null, end_minute: null };
const weekend = { id: "weekend", days_of_week: [0, 6], start_minute: null, end_minute: null };
const evening = { id: "evening", days_of_week: null, start_minute: 1080, end_minute: 1320 };

describe("isBaseRow / hasBaseRow / findBaseRow", () => {
  it("identifies the all-days/all-hours row as base", () => {
    expect(isBaseRow(base)).toBe(true);
    expect(isBaseRow(weekend)).toBe(false);
    expect(isBaseRow(evening)).toBe(false);
  });

  it("hasBaseRow / findBaseRow reflect the row set", () => {
    expect(hasBaseRow([weekend, evening])).toBe(false);
    expect(hasBaseRow([base, weekend])).toBe(true);
    expect(findBaseRow([base, weekend])?.id).toBe("base");
    expect(findBaseRow([weekend, evening])).toBeUndefined();
  });
});

describe("wouldRemoveBaseRowOnDelete", () => {
  it("true when deleting the only base row", () => {
    expect(wouldRemoveBaseRowOnDelete([base, weekend], "base")).toBe(true);
  });

  it("false when deleting a non-base row", () => {
    expect(wouldRemoveBaseRowOnDelete([base, weekend], "weekend")).toBe(false);
  });

  it("false when another base row remains", () => {
    const secondBase = { ...base, id: "base2" };
    expect(wouldRemoveBaseRowOnDelete([base, secondBase], "base")).toBe(false);
  });
});

describe("wouldRemoveBaseRowOnUpdate", () => {
  it("true when editing the only base row into a scoped override", () => {
    expect(
      wouldRemoveBaseRowOnUpdate([base, weekend], "base", {
        days_of_week: [1, 2, 3],
        start_minute: null,
        end_minute: null,
      }),
    ).toBe(true);
  });

  it("false when editing a non-base row (even into a base-shaped scope, since it's not converting the base row itself away)", () => {
    // Editing the weekend row to keep its own scope (still not base) is fine.
    expect(
      wouldRemoveBaseRowOnUpdate([base, weekend], "weekend", {
        days_of_week: [1, 2],
        start_minute: null,
        end_minute: null,
      }),
    ).toBe(false);
  });

  it("false when editing the base row but keeping it all-days/all-hours", () => {
    expect(
      wouldRemoveBaseRowOnUpdate([base, weekend], "base", {
        days_of_week: null,
        start_minute: null,
        end_minute: null,
      }),
    ).toBe(false);
  });

  it("false when another base row would still cover it", () => {
    const secondBase = { ...base, id: "base2" };
    expect(
      wouldRemoveBaseRowOnUpdate([base, secondBase], "base", {
        days_of_week: [1, 2],
        start_minute: null,
        end_minute: null,
      }),
    ).toBe(false);
  });
});
