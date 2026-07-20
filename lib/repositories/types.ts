// Row shapes for the shared catalog/reservation tables (spec §4) and the
// admin-owned tables (spec §5).
//
// Columns are kept in DB snake_case so a row round-trips 1:1 with what `pg`
// returns — no field renaming, no accidental drift from the storefront.
//
// Conventions baked in (see CLAUDE.md / spec §2):
//   • money is integer cents (never floats),
//   • times are minutes since local midnight in America/New_York (0–1440),
//   • days_of_week is smallint[] 0=Sun..6=Sat, null = every day,
//   • reservation start_at/end_at are real instants (timestamptz → JS Date).

// TODO(P9): consolidate — the SHARED-table shapes below (ItemRow, ItemPriceRow,
// CategoryRow, ItemCategoryRow, ReservationRow, AvailableHours) mirror the
// storefront's lib/products/types.ts + seed-products.mjs row shapes. When the
// shared package (phase P9) lands, import these from it instead of duplicating.

// ---------------------------------------------------------------------------
// items (shared, storefront-owned)
// ---------------------------------------------------------------------------

export type ItemType = "unique" | "fungible";
export type PricingUnit = "hour" | "day" | "event";

/** Hourly-item opening hours; null on the item means unrestricted (day items). */
export interface AvailableHours {
  openHour: number;
  closeHour: number;
  slotMinutes: number;
}

export interface ItemRow {
  id: string;
  slug: string;
  name: string;
  type: ItemType;
  total_stock: number;
  active: boolean;
  short_description: string | null;
  long_description: string | null;
  highlights: string[] | null;
  image: string | null;
  pricing_unit: PricingUnit;
  min_minutes: number | null;
  max_minutes: number | null;
  buffer_minutes: number;
  lead_hours: number;
  horizon_days: number;
  available_hours: AvailableHours | null;
  resource_id: number | null;
  sort_order: number;
  updated_at: Date;
}

/** Fields accepted when creating an item. Server sets updated_at. */
export interface ItemInsert {
  slug: string;
  name: string;
  type: ItemType;
  total_stock: number;
  active?: boolean;
  short_description?: string | null;
  long_description?: string | null;
  highlights?: string[] | null;
  image?: string | null;
  pricing_unit: PricingUnit;
  min_minutes?: number | null;
  max_minutes?: number | null;
  buffer_minutes?: number;
  lead_hours?: number;
  horizon_days?: number;
  available_hours?: AvailableHours | null;
  resource_id?: number | null;
  sort_order?: number;
}

/** Editable item fields. updated_at is always bumped to now() by the repo. */
export type ItemUpdate = Partial<Omit<ItemInsert, "slug">> & { slug?: string };

// ---------------------------------------------------------------------------
// item_prices (shared, scheduler + admin managed)
// ---------------------------------------------------------------------------

export interface ItemPriceRow {
  id: string;
  item_id: string;
  price_cents: number;
  days_of_week: number[] | null;
  start_minute: number | null;
  end_minute: number | null;
  priority: number;
  label: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ItemPriceInsert {
  item_id: string;
  price_cents: number;
  days_of_week?: number[] | null;
  start_minute?: number | null;
  end_minute?: number | null;
  priority?: number;
  label?: string | null;
}

export type ItemPriceUpdate = Partial<Omit<ItemPriceInsert, "item_id">>;

// ---------------------------------------------------------------------------
// categories (shared, admin managed)
// ---------------------------------------------------------------------------

export interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  sort_order: number;
  created_at: Date;
}

export interface CategoryInsert {
  slug: string;
  name: string;
  sort_order?: number;
}

export type CategoryUpdate = Partial<CategoryInsert>;

// ---------------------------------------------------------------------------
// item_categories (shared, admin managed join)
// ---------------------------------------------------------------------------

export interface ItemCategoryRow {
  item_id: string;
  category_id: string;
}

// ---------------------------------------------------------------------------
// reservations (shared, scheduler-writable). +group_id/+series_id added in §5.
// ---------------------------------------------------------------------------

export type ReservationStatus = "confirmed" | "block" | "cancelled";

export interface ReservationRow {
  id: string;
  item_id: string;
  quantity: number;
  start_at: Date;
  end_at: Date;
  status: ReservationStatus;
  order_id: string | null;
  customer_email: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  notes: string | null;
  group_id: string | null;
  series_id: string | null;
  created_at: Date;
}

/** Non-capacity, non-date edits (contact/notes). Date/capacity edits go
 *  through the race-safe engine (P2), NOT the repository. */
export interface ReservationContactUpdate {
  customer_email?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  notes?: string | null;
}

// ---------------------------------------------------------------------------
// reservation_groups (admin-owned, §5)
// ---------------------------------------------------------------------------

export interface ReservationGroupRow {
  id: string;
  title: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  series_id: string | null;
  occurrence_at: Date | null;
  created_by: string | null;
  created_at: Date;
}

export interface ReservationGroupInsert {
  title?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  notes?: string | null;
  series_id?: string | null;
  occurrence_at?: Date | null;
  created_by?: string | null;
}

export type ReservationGroupUpdate = Partial<ReservationGroupInsert>;

// ---------------------------------------------------------------------------
// reservation_series (admin-owned, §5)
// ---------------------------------------------------------------------------

export type SeriesFreq = "daily" | "weekly" | "monthly" | "yearly";

export interface ReservationSeriesRow {
  id: string;
  freq: SeriesFreq;
  interval: number;
  by_weekday: number[] | null;
  starts_on: string; // DATE — returned by pg as 'YYYY-MM-DD'
  until_date: string | null;
  count: number | null;
  created_by: string | null;
  created_at: Date;
}

export interface ReservationSeriesInsert {
  freq: SeriesFreq;
  interval?: number;
  by_weekday?: number[] | null;
  starts_on: string; // 'YYYY-MM-DD' (Eastern)
  until_date?: string | null;
  count?: number | null;
  created_by?: string | null;
}

// ---------------------------------------------------------------------------
// app_users (admin-owned, §5)
// ---------------------------------------------------------------------------

export type UserRole = "scheduler" | "admin";

export interface AppUserRow {
  id: string;
  uid: string;
  email: string | null;
  name: string | null;
  role: UserRole;
  active: boolean;
  last_login: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface AppUserInsert {
  uid: string;
  email?: string | null;
  name?: string | null;
  role: UserRole;
  active?: boolean;
}

// ---------------------------------------------------------------------------
// admin_audit_log (admin-owned, §5)
// ---------------------------------------------------------------------------

export interface AuditLogRow {
  id: string;
  actor_uid: string;
  actor_email: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  detail: unknown;
  created_at: Date;
}

export interface AuditLogInsert {
  actor_uid: string;
  actor_email?: string | null;
  action: string;
  entity: string;
  entity_id?: string | null;
  detail?: unknown;
}
