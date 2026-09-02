// Pure helpers for the Update Prices page (execution-plan P6.3, spec §4/§6/§7).
//
// Deliberately free of "use server", "server-only", Zod, and Next imports so
// these can be unit-tested directly (tests/price-validation.test.ts) and
// imported from both the server actions (app/prices/actions.ts) and the client
// UI (app/prices/prices-manager.tsx) for display formatting.
//
// Conventions enforced here (CLAUDE.md / spec §4):
//   • money is integer cents — parsed from the dollars STRING, never via
//     Math.round(parseFloat(x) * 100) (that drifts on some inputs);
//   • days_of_week is smallint[] 0=Sun..6=Sat, null = every day;
//   • start_minute/end_minute are Eastern minutes-since-midnight (0–1440),
//     both null or both set, end > start.

/** Minimal shape needed to reason about a price row's day/time scope. */
export interface PriceScope {
  days_of_week: number[] | null;
  start_minute: number | null;
  end_minute: number | null;
}

// ---------------------------------------------------------------------------
// Money: dollars string <-> integer cents (no floating-point drift)
// ---------------------------------------------------------------------------

// Whole dollars, optionally with 1-2 decimal digits. No sign — negative prices
// are never valid (spec §6: price_cents >= 0), so a leading "-" simply fails
// to match and is rejected below.
const DOLLARS_RE = /^(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Parse a user-entered dollars string into integer cents. Returns `null` for
 * anything that isn't a plain non-negative decimal with at most 2 fraction
 * digits (rejects "-1", "1.005", "abc", "", etc). Never uses `parseFloat` on
 * the whole value — the integer and fractional parts are parsed and combined
 * as integers so there is no floating-point rounding drift.
 */
export function parseDollarsToCents(input: string): number | null {
  const trimmed = input.trim();
  const match = DOLLARS_RE.exec(trimmed);
  if (!match) return null;
  const whole = Number(match[1]);
  const frac = (match[2] ?? "").padEnd(2, "0");
  const cents = whole * 100 + Number(frac);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Format integer cents as a "12.34"-style dollars string for display/inputs. */
export function formatCentsToDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}

// ---------------------------------------------------------------------------
// Day-of-week formatting + validation (0=Sun..6=Sat, null = every day)
// ---------------------------------------------------------------------------

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Human-readable day scope, e.g. "Every day" or "Sat, Sun". */
export function formatDaysOfWeek(days: number[] | null): string {
  if (!days || days.length === 0) return "Every day";
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  return sorted.map((d) => DAY_LABELS[d] ?? `day ${d}`).join(", ");
}

/**
 * Validate a `days_of_week` value. `null` (every day) is always valid. A
 * non-null value must be a non-empty array of unique integers in 0..6.
 * Returns an error message, or `null` if valid.
 */
export function validateDaysOfWeek(days: number[] | null): string | null {
  if (days === null) return null;
  if (days.length === 0) {
    return 'Select at least one day, or choose "every day".';
  }
  const seen = new Set<number>();
  for (const d of days) {
    if (!Number.isInteger(d) || d < 0 || d > 6) {
      return "Days must be whole numbers between 0 (Sun) and 6 (Sat).";
    }
    if (seen.has(d)) return "Each day can only be selected once.";
    seen.add(d);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hour-window formatting + validation (Eastern minutes-since-midnight)
// ---------------------------------------------------------------------------

/** Convert minutes-since-midnight (0-1440) to a "9:00 AM"-style label. */
export function formatMinutesOfDay(minutes: number): string {
  const totalMinutes = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12raw = h24 % 12;
  const h12 = h12raw === 0 ? 12 : h12raw;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** Human-readable hour window, e.g. "9:00 AM–5:00 PM" or "All hours". */
export function formatHourWindow(
  startMinute: number | null,
  endMinute: number | null,
): string {
  if (startMinute === null || endMinute === null) return "All hours";
  // 1440 means "midnight at the end of the day" — render as 12:00 AM (next
  // day) rather than wrapping back to the same-day label.
  const endLabel = endMinute === 1440 ? "12:00 AM" : formatMinutesOfDay(endMinute);
  return `${formatMinutesOfDay(startMinute)}–${endLabel}`;
}

/**
 * Validate `start_minute`/`end_minute`: both null (all hours) or both set,
 * each in 0..1440, and end > start. Returns an error message, or `null` if
 * valid.
 */
export function validateHourWindow(
  startMinute: number | null,
  endMinute: number | null,
): string | null {
  if (startMinute === null && endMinute === null) return null;
  if (startMinute === null || endMinute === null) {
    return "Set both a start and end time, or leave both blank for all hours.";
  }
  if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute)) {
    return "Times must be whole minutes.";
  }
  if (startMinute < 0 || startMinute > 1440 || endMinute < 0 || endMinute > 1440) {
    return "Times must be between 0 and 1440 minutes (0:00–24:00).";
  }
  if (endMinute <= startMinute) {
    return "End time must be after start time.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Base-row logic (spec §4/§6/§7): the all-days/all-hours row is the item's
// fallback rate. The storefront can't quote the item without one.
// ---------------------------------------------------------------------------

/** A "base" row applies to every day and every hour — the item's fallback rate. */
export function isBaseRow(row: PriceScope): boolean {
  return (
    row.days_of_week === null && row.start_minute === null && row.end_minute === null
  );
}

/** Does this set of rows include an all-days/all-hours base row? */
export function hasBaseRow(rows: PriceScope[]): boolean {
  return rows.some(isBaseRow);
}

/** The item's base row, if one exists. */
export function findBaseRow<T extends PriceScope>(rows: T[]): T | undefined {
  return rows.find(isBaseRow);
}

/**
 * Would deleting the row `id` leave the item with no all-days/all-hours base
 * row? False if the row being deleted isn't the base row (deleting an
 * override never removes the base row), or if some OTHER row is already a
 * base row (shouldn't normally happen, but defensive).
 */
export function wouldRemoveBaseRowOnDelete<T extends PriceScope & { id: string }>(
  rows: T[],
  id: string,
): boolean {
  const target = rows.find((r) => r.id === id);
  if (!target || !isBaseRow(target)) return false;
  const remaining = rows.filter((r) => r.id !== id);
  return !hasBaseRow(remaining);
}

/**
 * Would updating the row `id` to `nextScope` leave the item with no
 * all-days/all-hours base row? True exactly when the row being edited is
 * CURRENTLY the (only) base row and the new scope is no longer all-days/
 * all-hours. Editing a non-base row, or editing the base row while another
 * base row still exists, never triggers this.
 */
export function wouldRemoveBaseRowOnUpdate<T extends PriceScope & { id: string }>(
  rows: T[],
  id: string,
  nextScope: PriceScope,
): boolean {
  const others = rows.filter((r) => r.id !== id);
  if (hasBaseRow(others)) return false; // another row still covers the base case
  const target = rows.find((r) => r.id === id);
  const wasBase = target ? isBaseRow(target) : false;
  const willBeBase = isBaseRow(nextScope);
  return wasBase && !willBeBase;
}
