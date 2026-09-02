import { describe, expect, it } from "vitest";

// P6.4 — pure validation/parsing helper tests (app/products/validation.ts).
// Deliberately no mocking: this module is pure (no "use server", no
// "server-only"), so it's imported and exercised directly.

import {
  dollarsToCentsSchema,
  itemFieldsSchema,
  readItemFormFields,
  slugSchema,
  slugify,
  SLUG_PATTERN,
} from "@/app/products/validation";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

// A complete, valid set of raw fields for itemFieldsSchema, with overrides.
function validFields(over: Record<string, unknown> = {}) {
  return {
    slug: "party-room",
    name: "Party Room",
    type: "fungible",
    totalStock: 3,
    active: true,
    shortDescription: undefined,
    longDescription: undefined,
    highlights: undefined,
    image: undefined,
    pricingUnit: "day",
    minMinutes: undefined,
    maxMinutes: undefined,
    bufferMinutes: 0,
    leadHours: 0,
    horizonDays: 365,
    availableHours: null,
    sortOrder: 0,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// slug URL-safety
// ---------------------------------------------------------------------------
describe("slug URL-safety (SLUG_PATTERN / slugSchema)", () => {
  const rejected = ["Party Room", "party_room", "-party", "party--room", "Party-Room"];
  for (const bad of rejected) {
    it(`rejects "${bad}"`, () => {
      expect(SLUG_PATTERN.test(bad)).toBe(false);
      expect(slugSchema.safeParse(bad).success).toBe(false);
    });
  }

  const accepted = ["party-room", "tent10"];
  for (const good of accepted) {
    it(`accepts "${good}"`, () => {
      expect(SLUG_PATTERN.test(good)).toBe(true);
      expect(slugSchema.safeParse(good).success).toBe(true);
    });
  }
});

describe("slugify", () => {
  it("derives a URL-safe slug from a display name", () => {
    expect(slugify("Party Room")).toBe("party-room");
    expect(slugify("  Tent 10 ft  ")).toBe("tent-10-ft");
    expect(slugify("Auditorium & Stage")).toBe("auditorium-stage");
  });

  it("the derived slug always satisfies SLUG_PATTERN for non-empty input", () => {
    expect(SLUG_PATTERN.test(slugify("Party Room"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// dollars -> integer cents (exact, no float drift)
// ---------------------------------------------------------------------------
describe("dollarsToCentsSchema", () => {
  it("parses whole dollars", () => {
    expect(dollarsToCentsSchema.parse("25")).toBe(2500);
    expect(dollarsToCentsSchema.parse("5")).toBe(500);
  });

  it("parses exact cents with no floating-point drift", () => {
    expect(dollarsToCentsSchema.parse("25.50")).toBe(2550);
    expect(dollarsToCentsSchema.parse("0.01")).toBe(1);
    expect(dollarsToCentsSchema.parse("0.1")).toBe(10);
    expect(dollarsToCentsSchema.parse("19.99")).toBe(1999);
    expect(dollarsToCentsSchema.parse("100.00")).toBe(10000);
  });

  it("rejects negative, malformed, and over-precise amounts", () => {
    expect(dollarsToCentsSchema.safeParse("-5").success).toBe(false);
    expect(dollarsToCentsSchema.safeParse("$5").success).toBe(false);
    expect(dollarsToCentsSchema.safeParse("5.999").success).toBe(false);
    expect(dollarsToCentsSchema.safeParse("abc").success).toBe(false);
    expect(dollarsToCentsSchema.safeParse("").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// itemFieldsSchema — mirrors the `items` table check constraints
// ---------------------------------------------------------------------------
describe("itemFieldsSchema — check-constraint validation", () => {
  it("accepts a fully valid payload", () => {
    const result = itemFieldsSchema.safeParse(validFields());
    expect(result.success).toBe(true);
  });

  it("rejects total_stock <= 0", () => {
    expect(itemFieldsSchema.safeParse(validFields({ totalStock: 0 })).success).toBe(false);
    expect(itemFieldsSchema.safeParse(validFields({ totalStock: -1 })).success).toBe(false);
  });

  it("rejects type='unique' with total_stock > 1", () => {
    const result = itemFieldsSchema.safeParse(
      validFields({ type: "unique", totalStock: 2 }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts type='unique' with total_stock === 1", () => {
    const result = itemFieldsSchema.safeParse(
      validFields({ type: "unique", totalStock: 1 }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects negative buffer_minutes", () => {
    expect(itemFieldsSchema.safeParse(validFields({ bufferMinutes: -1 })).success).toBe(false);
  });

  it("rejects negative lead_hours", () => {
    expect(itemFieldsSchema.safeParse(validFields({ leadHours: -1 })).success).toBe(false);
  });

  it("rejects horizon_days <= 0", () => {
    expect(itemFieldsSchema.safeParse(validFields({ horizonDays: 0 })).success).toBe(false);
    expect(itemFieldsSchema.safeParse(validFields({ horizonDays: -10 })).success).toBe(false);
  });

  it("rejects max_minutes < min_minutes", () => {
    const result = itemFieldsSchema.safeParse(
      validFields({ minMinutes: 120, maxMinutes: 60 }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts max_minutes >= min_minutes", () => {
    const result = itemFieldsSchema.safeParse(
      validFields({ minMinutes: 60, maxMinutes: 120 }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects malformed available_hours (partial trio)", () => {
    const result = itemFieldsSchema.safeParse(
      validFields({ availableHours: { openHour: 8, closeHour: undefined, slotMinutes: 30 } }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects available_hours where openHour >= closeHour", () => {
    const result = itemFieldsSchema.safeParse(
      validFields({ availableHours: { openHour: 20, closeHour: 8, slotMinutes: 30 } }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects available_hours with closeHour > 24", () => {
    const result = itemFieldsSchema.safeParse(
      validFields({ availableHours: { openHour: 8, closeHour: 25, slotMinutes: 30 } }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects available_hours with non-positive slotMinutes", () => {
    const result = itemFieldsSchema.safeParse(
      validFields({ availableHours: { openHour: 8, closeHour: 20, slotMinutes: 0 } }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts null available_hours (unrestricted, e.g. day items)", () => {
    const result = itemFieldsSchema.safeParse(validFields({ availableHours: null }));
    expect(result.success).toBe(true);
  });

  it("accepts a complete valid available_hours trio", () => {
    const result = itemFieldsSchema.safeParse(
      validFields({ availableHours: { openHour: 8, closeHour: 20, slotMinutes: 30 } }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects an invalid type", () => {
    expect(itemFieldsSchema.safeParse(validFields({ type: "widget" })).success).toBe(false);
  });

  it("rejects an invalid pricing unit", () => {
    expect(itemFieldsSchema.safeParse(validFields({ pricingUnit: "week" })).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// readItemFormFields — FormData -> raw shape
// ---------------------------------------------------------------------------
describe("readItemFormFields", () => {
  it("splits highlights by line, trims, and drops blank lines", () => {
    const fd = form({ highlights: "Seats 50\n\n  Great view  \nParking included\n" });
    const raw = readItemFormFields(fd);
    expect(raw.highlights).toEqual(["Seats 50", "Great view", "Parking included"]);
  });

  it("omits highlights entirely when blank", () => {
    const fd = form({ highlights: "\n\n  " });
    const raw = readItemFormFields(fd);
    expect(raw.highlights).toBeUndefined();
  });

  it("reads availableHours only when availableHoursEnabled is checked", () => {
    const enabled = form({
      availableHoursEnabled: "on",
      availableHoursOpen: "8",
      availableHoursClose: "20",
      availableHoursSlot: "30",
    });
    expect(readItemFormFields(enabled).availableHours).toEqual({
      openHour: 8,
      closeHour: 20,
      slotMinutes: 30,
    });

    const disabled = form({
      availableHoursOpen: "8",
      availableHoursClose: "20",
      availableHoursSlot: "30",
    });
    expect(readItemFormFields(disabled).availableHours).toBeNull();
  });

  it("applies numeric defaults for blank buffer/lead/horizon/sort fields", () => {
    const fd = form({});
    const raw = readItemFormFields(fd);
    expect(raw.bufferMinutes).toBe(0);
    expect(raw.leadHours).toBe(0);
    expect(raw.horizonDays).toBe(365);
    expect(raw.sortOrder).toBe(0);
    expect(raw.minMinutes).toBeUndefined();
    expect(raw.maxMinutes).toBeUndefined();
  });

  it("reads active from the checkbox convention", () => {
    expect(readItemFormFields(form({ active: "on" })).active).toBe(true);
    expect(readItemFormFields(form({})).active).toBe(false);
  });
});
