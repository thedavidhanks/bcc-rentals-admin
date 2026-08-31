import { describe, expect, it } from "vitest";
import { PolicyError, validateBooking, type ItemPolicy } from "@/lib/scheduler/policy";

// A day-scoped item (no available-hours / slot constraints).
const dayItem: ItemPolicy = {
  pricingUnit: "day",
  leadHours: 24,
  horizonDays: 180,
  availableHours: null,
};

// An hour-scoped item: open 09:00–21:00 ET, 60-minute slots.
const hourItem: ItemPolicy = {
  pricingUnit: "hour",
  leadHours: 24,
  horizonDays: 90,
  availableHours: { openHour: 9, closeHour: 21, slotMinutes: 60 },
};

const NOW = new Date("2026-07-10T12:00:00Z");

// 2026-08-01 00:00 ET (EDT = UTC-4). `at()` returns the ISO string for an ET
// hour/minute on that day.
const ET_MIDNIGHT_AUG1 = Date.parse("2026-08-01T04:00:00Z");
const at = (etHour: number, etMin = 0) =>
  new Date(ET_MIDNIGHT_AUG1 + etHour * 3_600_000 + etMin * 60_000).toISOString();

describe("validateBooking — lead time & horizon", () => {
  it("accepts a booking beyond the lead time and within the horizon", () => {
    expect(() =>
      validateBooking(dayItem, "2026-07-20T00:00:00Z", "2026-07-21T00:00:00Z", {}, NOW),
    ).not.toThrow();
  });

  it("rejects a booking inside the lead time", () => {
    expect(() =>
      validateBooking(dayItem, "2026-07-11T00:00:00Z", "2026-07-12T00:00:00Z", {}, NOW),
    ).toThrow(expect.objectContaining({ code: "lead-time" }));
  });

  it("rejects a booking beyond the horizon", () => {
    expect(() =>
      validateBooking(dayItem, "2027-03-01T00:00:00Z", "2027-03-02T00:00:00Z", {}, NOW),
    ).toThrow(expect.objectContaining({ code: "horizon" }));
  });

  it("bypasses lead time for staff blocks", () => {
    expect(() =>
      validateBooking(
        dayItem,
        "2026-07-11T00:00:00Z",
        "2026-07-12T00:00:00Z",
        { bypassLeadTime: true },
        NOW,
      ),
    ).not.toThrow();
  });

  it("bypasses horizon for staff blocks", () => {
    expect(() =>
      validateBooking(
        dayItem,
        "2027-03-01T00:00:00Z",
        "2027-03-02T00:00:00Z",
        { bypassHorizon: true },
        NOW,
      ),
    ).not.toThrow();
  });
});

describe("validateBooking — hourly available hours & slots", () => {
  it("accepts a booking within open hours up to the closing boundary", () => {
    expect(() => validateBooking(hourItem, at(15), at(21), {}, NOW)).not.toThrow();
  });

  it("rejects a booking ending after close", () => {
    expect(() =>
      validateBooking(hourItem, at(18), at(21, 30), {}, NOW),
    ).toThrow(expect.objectContaining({ code: "available-hours" }));
  });

  it("rejects a booking starting before open", () => {
    expect(() =>
      validateBooking(hourItem, at(8), at(10), {}, NOW),
    ).toThrow(expect.objectContaining({ code: "available-hours" }));
  });

  it("rejects a start not aligned to the slot", () => {
    expect(() =>
      validateBooking(hourItem, at(14, 15), at(16, 15), {}, NOW),
    ).toThrow(expect.objectContaining({ code: "slot-alignment" }));
  });

  it("rejects an hourly booking crossing midnight / different days", () => {
    // 23:00 ET Aug 1 → 01:00 ET Aug 2.
    expect(() =>
      validateBooking(hourItem, at(23), at(25), {}, NOW),
    ).toThrow(expect.objectContaining({ code: "available-hours" }));
  });

  it("skips hour checks for day-scoped items", () => {
    expect(() =>
      validateBooking(dayItem, at(14, 15), at(16, 15), {}, NOW),
    ).not.toThrow();
  });

  it("still enforces available-hours when only lead/horizon are bypassed", () => {
    // A staff block outside open hours is still rejected unless it also opts out
    // of the available-hours rule.
    expect(() =>
      validateBooking(
        hourItem,
        at(8),
        at(10),
        { bypassLeadTime: true, bypassHorizon: true },
        NOW,
      ),
    ).toThrow(expect.objectContaining({ code: "available-hours" }));
  });

  it("can bypass available-hours for an out-of-hours staff block", () => {
    expect(() =>
      validateBooking(
        hourItem,
        at(8),
        at(10),
        { bypassLeadTime: true, bypassHorizon: true, bypassAvailableHours: true },
        NOW,
      ),
    ).not.toThrow();
  });

  it("throws PolicyError instances", () => {
    try {
      validateBooking(hourItem, at(8), at(10), {}, NOW);
      throw new Error("expected a throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyError);
    }
  });
});
