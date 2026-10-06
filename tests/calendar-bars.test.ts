import { describe, expect, it } from "vitest";

import {
  buildCalendarBars,
  buildItemSubtitle,
  ITEM_SUBTITLE_MAX_NAMES,
  type CalendarBarItem,
} from "../lib/calendar/bars";
import type { ReservationRow, ReservationStatus } from "../lib/repositories/types";

let nextId = 1;

function row(overrides: Partial<ReservationRow> = {}): ReservationRow {
  const id = overrides.id ?? `r${nextId++}`;
  return {
    id,
    item_id: "item-1",
    quantity: 1,
    start_at: new Date("2026-07-20T14:00:00Z"),
    end_at: new Date("2026-07-20T16:00:00Z"),
    status: "block",
    order_id: null,
    customer_email: null,
    customer_name: null,
    customer_phone: null,
    notes: null,
    group_id: null,
    series_id: null,
    created_at: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

const ITEMS = new Map<string, CalendarBarItem>([
  ["item-1", { name: "Auditorium", slug: "auditorium" }],
  ["item-2", { name: "Room A", slug: "room-a" }],
  ["item-3", { name: "Room B", slug: "room-b" }],
  ["item-4", { name: "Chairs", slug: "chairs" }],
]);

describe("buildCalendarBars — grouping (P11.6)", () => {
  it("collapses a 3-row group into 1 bar", () => {
    const rows = [
      row({ item_id: "item-1", group_id: "g1" }),
      row({ item_id: "item-2", group_id: "g1" }),
      row({ item_id: "item-3", group_id: "g1" }),
    ];
    const bars = buildCalendarBars(rows, ITEMS, new Map([["g1", "Sunday service"]]));
    expect(bars).toHaveLength(1);
    expect(bars[0].groupId).toBe("g1");
    expect(bars[0].itemNames).toEqual(["Auditorium", "Room A", "Room B"]);
  });

  it("renders 3 ungrouped rows as 3 separate bars", () => {
    const rows = [
      row({ item_id: "item-1" }),
      row({ item_id: "item-2" }),
      row({ item_id: "item-3" }),
    ];
    const bars = buildCalendarBars(rows, ITEMS, new Map());
    expect(bars).toHaveLength(3);
    expect(bars.every((b) => b.groupId === null)).toBe(true);
    // Each ungrouped bar's key is distinct and derived from its row id.
    expect(new Set(bars.map((b) => b.key)).size).toBe(3);
  });

  it("envelope spans the union of the group's windows (Mon–Tue + Mon–Wed ⇒ Mon–Wed)", () => {
    const rows = [
      row({
        group_id: "g1",
        start_at: new Date("2026-07-20T12:00:00Z"), // Mon
        end_at: new Date("2026-07-21T12:00:00Z"), // Tue
      }),
      row({
        group_id: "g1",
        item_id: "item-2",
        start_at: new Date("2026-07-20T12:00:00Z"), // Mon
        end_at: new Date("2026-07-22T12:00:00Z"), // Wed
      }),
    ];
    const bars = buildCalendarBars(rows, ITEMS, new Map());
    expect(bars).toHaveLength(1);
    expect(bars[0].start_at.toISOString()).toBe("2026-07-20T12:00:00.000Z");
    expect(bars[0].end_at.toISOString()).toBe("2026-07-22T12:00:00.000Z");
  });

  it("falls back to the first item's name when title is null", () => {
    const rows = [row({ group_id: "g1", item_id: "item-2" })];
    const bars = buildCalendarBars(rows, ITEMS, new Map([["g1", null]]));
    expect(bars[0].label).toBe("Room A");
  });

  it("falls back to 'Unknown item' when there is no title and no known item", () => {
    const rows = [row({ group_id: "g1", item_id: "item-does-not-exist" })];
    const bars = buildCalendarBars(rows, ITEMS, new Map([["g1", null]]));
    expect(bars[0].label).toBe("Unknown item");
  });

  it("uses the group's title when present, even over the first item's name", () => {
    const rows = [row({ group_id: "g1", item_id: "item-1" })];
    const bars = buildCalendarBars(rows, ITEMS, new Map([["g1", "Sunday service"]]));
    expect(bars[0].label).toBe("Sunday service");
  });

  describe("mixed-status precedence (§4.1)", () => {
    const makeMixed = (statuses: ReservationStatus[]) =>
      buildCalendarBars(
        statuses.map((status, i) => row({ group_id: "g1", item_id: `item-${(i % 4) + 1}`, status })),
        ITEMS,
        new Map(),
      )[0];

    it("is cancelled only when every row is cancelled", () => {
      expect(makeMixed(["cancelled", "cancelled", "cancelled"]).status).toBe("cancelled");
    });

    it("is confirmed if any row is confirmed, even with a cancelled sibling", () => {
      expect(makeMixed(["cancelled", "confirmed", "block"]).status).toBe("confirmed");
    });

    it("is block when no row is confirmed but not all are cancelled", () => {
      expect(makeMixed(["cancelled", "block", "block"]).status).toBe("block");
    });

    it("a cancelled line item does not stretch the envelope or padd the item list", () => {
      const rows = [
        row({
          group_id: "g1",
          item_id: "item-1",
          status: "block",
          start_at: new Date("2026-07-20T12:00:00Z"),
          end_at: new Date("2026-07-20T14:00:00Z"),
        }),
        row({
          group_id: "g1",
          item_id: "item-4", // the cancelled chair order
          status: "cancelled",
          start_at: new Date("2026-07-10T00:00:00Z"),
          end_at: new Date("2026-08-01T00:00:00Z"),
        }),
      ];
      const bars = buildCalendarBars(rows, ITEMS, new Map());
      expect(bars).toHaveLength(1);
      expect(bars[0].status).toBe("block");
      expect(bars[0].start_at.toISOString()).toBe("2026-07-20T12:00:00.000Z");
      expect(bars[0].end_at.toISOString()).toBe("2026-07-20T14:00:00.000Z");
      expect(bars[0].itemNames).toEqual(["Auditorium"]);
    });

    it("an all-cancelled group still gets an envelope and item list from its own rows", () => {
      const rows = [
        row({
          group_id: "g1",
          item_id: "item-4",
          status: "cancelled",
          start_at: new Date("2026-07-10T00:00:00Z"),
          end_at: new Date("2026-07-11T00:00:00Z"),
        }),
      ];
      const bars = buildCalendarBars(rows, ITEMS, new Map());
      expect(bars[0].status).toBe("cancelled");
      expect(bars[0].itemNames).toEqual(["Chairs"]);
    });
  });

  describe("item subtitle truncation", () => {
    it("joins names up to the cap with no truncation marker", () => {
      expect(buildItemSubtitle(["Auditorium", "Room A"])).toBe("Auditorium, Room A");
      expect(ITEM_SUBTITLE_MAX_NAMES).toBeGreaterThanOrEqual(2);
    });

    it("truncates with a +N count beyond the cap, while the full list stays on the bar", () => {
      const rows = [
        row({ group_id: "g1", item_id: "item-1" }),
        row({ group_id: "g1", item_id: "item-2" }),
        row({ group_id: "g1", item_id: "item-3" }),
        row({ group_id: "g1", item_id: "item-4" }),
      ];
      const bars = buildCalendarBars(rows, ITEMS, new Map());
      expect(bars[0].itemNames).toEqual(["Auditorium", "Room A", "Room B", "Chairs"]);
      expect(bars[0].subtitle).toBe("Auditorium, Room A +2");
      expect(buildItemSubtitle(bars[0].itemNames)).toBe(bars[0].subtitle);
    });
  });
});
