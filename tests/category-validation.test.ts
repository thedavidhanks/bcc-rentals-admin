import { describe, expect, it } from "vitest";

import {
  SLUG_PATTERN,
  categoryCreateSchema,
  categoryUpdateSchema,
  slugify,
} from "@/app/categories/validation";

// Pure-helper tests for the P6.5 Categories admin screen. No DB/guard mocking
// needed — validation.ts is deliberately DB-free (see its header comment).

describe("SLUG_PATTERN — URL-safety", () => {
  const reject = [
    "Party Room",
    "party_room",
    "-room",
    "room--tool",
    "Room",
    "",
    "room ",
    "café", // non-ASCII must not sneak through as a "letter"
    "room-", // trailing hyphen
    "room.tool", // dot is not a valid separator
  ];
  const accept = ["event-add-on", "room", "a1-b2", "chairs200", "123"];

  for (const bad of reject) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      expect(SLUG_PATTERN.test(bad)).toBe(false);
    });
  }

  for (const good of accept) {
    it(`accepts ${JSON.stringify(good)}`, () => {
      expect(SLUG_PATTERN.test(good)).toBe(true);
    });
  }
});

describe("slugify", () => {
  it("lowercases, trims, and hyphenates a display name", () => {
    expect(slugify("Party Room")).toBe("party-room");
    expect(slugify("  Event Add-On  ")).toBe("event-add-on");
  });

  it("collapses repeated separators and strips leading/trailing hyphens", () => {
    expect(slugify("Room -- Tool")).toBe("room-tool");
    expect(slugify("--Chairs--")).toBe("chairs");
  });

  it("produces output that satisfies SLUG_PATTERN for typical names", () => {
    for (const name of ["Party Room", "Event Add-On", "Chairs (200)", "  Tools  "]) {
      const slug = slugify(name);
      expect(SLUG_PATTERN.test(slug)).toBe(true);
    }
  });

  it("non-ASCII letters are stripped, not preserved (result may still need editing)", () => {
    // slugify is a convenience suggestion only (per its docstring) — it does
    // not transliterate accented/unicode letters, it just drops them.
    expect(slugify("café")).toBe("caf");
  });

  it("a name with no ASCII alphanumerics collapses to an empty string (caller must still validate)", () => {
    // The Zod schema (tested below) is what actually rejects an empty slug —
    // slugify itself has no non-empty guarantee.
    expect(slugify("!!!")).toBe("");
  });
});

describe("categoryCreateSchema", () => {
  it("accepts a valid payload and defaults sort_order to 0 when omitted-as-empty", () => {
    const result = categoryCreateSchema.safeParse({
      slug: "event-add-on",
      name: "Event Add-On",
      sort_order: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sort_order).toBe(0);
    }
  });

  it("rejects an unsafe slug", () => {
    const result = categoryCreateSchema.safeParse({
      slug: "Party Room",
      name: "Party Room",
      sort_order: "0",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "slug")).toBe(true);
    }
  });

  it("rejects an empty name", () => {
    const result = categoryCreateSchema.safeParse({
      slug: "room",
      name: "   ",
      sort_order: "0",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-numeric sort_order", () => {
    const result = categoryCreateSchema.safeParse({
      slug: "room",
      name: "Room",
      sort_order: "not-a-number",
    });
    expect(result.success).toBe(false);
  });

  it("coerces a numeric-string sort_order", () => {
    const result = categoryCreateSchema.safeParse({
      slug: "room",
      name: "Room",
      sort_order: "3",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sort_order).toBe(3);
  });
});

describe("categoryUpdateSchema", () => {
  it("requires an id in addition to slug/name/sort_order", () => {
    const missingId = categoryUpdateSchema.safeParse({
      id: "",
      slug: "room",
      name: "Room",
      sort_order: "0",
    });
    expect(missingId.success).toBe(false);

    const withId = categoryUpdateSchema.safeParse({
      id: "cat-1",
      slug: "room",
      name: "Room",
      sort_order: "0",
    });
    expect(withId.success).toBe(true);
  });
});
