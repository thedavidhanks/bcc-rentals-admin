import type { UserRole } from "@/lib/auth/guards";

export interface NavItem {
  /** Visible label in the menu bar. */
  label: string;
  /** Route the entry links to. */
  href: string;
  /** When true, only admins see this entry (cosmetic — server still enforces). */
  adminOnly?: boolean;
}

/**
 * The global menu-bar entries, in display order (spec §7).
 * Admin-only entries (Products, Categories, Users) are hidden for schedulers
 * here for convenience; real access control lives in the server guards /
 * route actions (`app/**\/page.tsx` calling `requireAdmin`/`requireScheduler`).
 * `tests/nav-guard-parity.test.ts` asserts this list stays in sync with those
 * guards — update both together.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Calendar", href: "/calendar" },
  { label: "Products", href: "/products", adminOnly: true },
  { label: "Add Reservation", href: "/reservations/new" },
  { label: "Update Prices", href: "/prices" },
  { label: "Categories", href: "/categories", adminOnly: true },
  { label: "Users", href: "/users", adminOnly: true },
];

/** Filter the menu entries down to what the given role may see. */
export function navItemsForRole(role: UserRole): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || role === "admin");
}
