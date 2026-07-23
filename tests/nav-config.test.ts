import { describe, expect, it } from "vitest";
import { NAV_ITEMS, navItemsForRole } from "@/components/nav/nav-config";

describe("navItemsForRole", () => {
  it("shows all entries (including admin-only) to admins", () => {
    const labels = navItemsForRole("admin").map((i) => i.label);
    expect(labels).toEqual([
      "Calendar",
      "Products",
      "Add Reservation",
      "Update Prices",
      "Categories",
      "Users",
    ]);
  });

  it("hides admin-only entries from schedulers", () => {
    const labels = navItemsForRole("scheduler").map((i) => i.label);
    expect(labels).toEqual([
      "Calendar",
      "Products",
      "Add Reservation",
      "Update Prices",
    ]);
    expect(labels).not.toContain("Categories");
    expect(labels).not.toContain("Users");
  });

  it("marks exactly Categories and Users as admin-only", () => {
    const adminOnly = NAV_ITEMS.filter((i) => i.adminOnly).map((i) => i.label);
    expect(adminOnly).toEqual(["Categories", "Users"]);
  });

  it("routes every entry to a non-empty absolute path", () => {
    for (const item of NAV_ITEMS) {
      expect(item.href.startsWith("/")).toBe(true);
    }
  });
});
