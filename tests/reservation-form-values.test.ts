import { describe, expect, it } from "vitest";

import {
  EMPTY_SUBMITTED_VALUES,
  readSubmittedValues,
} from "@/app/reservations/new/form-values";

// Pure-module tests for app/reservations/new/form-values.ts (execution-plan
// P11.10). This logic is factored out of actions.ts / reservation-form.tsx
// specifically so it is unit-testable: vitest.config.ts only collects
// tests/**/*.test.ts (no jsdom, no .tsx), so a client component can't be
// exercised directly — this module has no "use server", no "server-only", no
// DB import, and is importable from both sides.

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
    else fd.set(k, v);
  }
  return fd;
}

describe("EMPTY_SUBMITTED_VALUES", () => {
  it("has one empty line row and the same defaults the form renders", () => {
    expect(EMPTY_SUBMITTED_VALUES).toEqual({
      date: "",
      startMinute: "",
      endMinute: "",
      title: "",
      contactName: "",
      contactEmail: "",
      contactPhone: "",
      notes: "",
      recurring: false,
      recurrence: {
        freq: "weekly",
        interval: "1",
        byWeekday: [],
        endMode: "count",
        untilDate: "",
        count: "4",
      },
      lines: [{ itemSlug: "", quantity: "1" }],
    });
  });
});

describe("readSubmittedValues", () => {
  it("reads the shared When box and a single line", () => {
    const values = readSubmittedValues(
      form({
        date: "2026-08-02",
        startMinute: "09:00",
        endMinute: "12:00",
        "line-0-itemSlug": "auditorium",
        "line-0-quantity": "3",
      }),
    );

    expect(values.date).toBe("2026-08-02");
    expect(values.startMinute).toBe("09:00");
    expect(values.endMinute).toBe("12:00");
    expect(values.lines).toEqual([{ itemSlug: "auditorium", quantity: "3" }]);
    expect(values.recurring).toBe(false);
  });

  it("collects non-contiguous line indices, sorted", () => {
    const values = readSubmittedValues(
      form({
        "line-5-itemSlug": "tent",
        "line-5-quantity": "2",
        "line-1-itemSlug": "chairs",
        "line-1-quantity": "50",
      }),
    );

    expect(values.lines).toEqual([
      { itemSlug: "chairs", quantity: "50" },
      { itemSlug: "tent", quantity: "2" },
    ]);
  });

  it("missing fields become empty strings, not undefined", () => {
    const values = readSubmittedValues(form({}));

    expect(values.date).toBe("");
    expect(values.startMinute).toBe("");
    expect(values.endMinute).toBe("");
    expect(values.title).toBe("");
    expect(values.contactName).toBe("");
    expect(values.contactEmail).toBe("");
    expect(values.contactPhone).toBe("");
    expect(values.notes).toBe("");
    expect(values.lines).toEqual([]);
    expect(values.recurring).toBe(false);
  });

  it("defaults a missing per-line quantity to '1' but leaves itemSlug empty", () => {
    const values = readSubmittedValues(form({ "line-0-itemSlug": "" }));
    expect(values.lines).toEqual([{ itemSlug: "", quantity: "1" }]);
  });

  it("recurring=on reads the recurrence sub-fields, including multi-value byWeekday", () => {
    const values = readSubmittedValues(
      form({
        recurring: "on",
        "recurrence-freq": "weekly",
        "recurrence-interval": "2",
        "recurrence-byWeekday": ["0", "3", "5"],
        "recurrence-endMode": "until",
        "recurrence-untilDate": "2026-12-31",
      }),
    );

    expect(values.recurring).toBe(true);
    expect(values.recurrence).toEqual({
      freq: "weekly",
      interval: "2",
      byWeekday: ["0", "3", "5"],
      endMode: "until",
      untilDate: "2026-12-31",
      count: "4",
    });
  });

  it("recurring=off still echoes back whatever recurrence fields were submitted", () => {
    const values = readSubmittedValues(
      form({
        "recurrence-freq": "daily",
        "recurrence-interval": "3",
      }),
    );

    expect(values.recurring).toBe(false);
    expect(values.recurrence.freq).toBe("daily");
    expect(values.recurrence.interval).toBe("3");
  });

  it("treats the string 'true' as recurring, matching the checkbox 'on' case", () => {
    const values = readSubmittedValues(form({ recurring: "true" }));
    expect(values.recurring).toBe(true);
  });

  it("recurrence byWeekday defaults to an empty array when none are checked", () => {
    const values = readSubmittedValues(form({ recurring: "on" }));
    expect(values.recurrence.byWeekday).toEqual([]);
  });
});
