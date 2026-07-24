// Per-item booking policy validation. Pure module over an item's policy fields —
// no DB/secrets — so it's unit-testable and importable anywhere.
//
// P9.2: extracted into the shared @bcc/scheduler package (was admin
// lib/scheduler/policy.ts; lib/scheduler/policy.ts is now a re-export shim).
// TODO(P9): consolidate — mirrors storefront lib/scheduler/policy.ts. Adapted to the
// admin's `items` column shape (pricing_unit / lead_hours / horizon_days /
// available_hours) rather than the storefront's mapped Product type, and adds
// per-rule bypass flags for staff blocks (spec §8: staff may bypass lead-time /
// horizon, but capacity is always enforced by the engine — never here).
// P9.3/P9.4 reconcile the two implementations behind this single module.

// BCC operates in Eastern time; available-hours are local wall-clock hours.
const BCC_TIMEZONE = "America/New_York";

export type PolicyCode = "lead-time" | "horizon" | "available-hours" | "slot-alignment";

/** The policy-relevant fields of an `items` row (spec §4). */
export type ItemPolicy = {
  /** items.pricing_unit — hour-scoped items enforce available-hours + slot alignment. */
  pricingUnit: "hour" | "day" | "event";
  /** items.lead_hours — minimum lead time (hours) before a booking may start. */
  leadHours: number;
  /** items.horizon_days — how far ahead a booking may start. */
  horizonDays: number;
  /** items.available_hours — open/close/slot for hourly items; null = unrestricted. */
  availableHours: { openHour: number; closeHour: number; slotMinutes: number } | null;
};

/** Which rules to skip. Staff blocks typically bypass lead-time + horizon. */
export type PolicyOptions = {
  bypassLeadTime?: boolean;
  bypassHorizon?: boolean;
  bypassAvailableHours?: boolean;
};

/** A booking that violates a per-item policy rule. */
export class PolicyError extends Error {
  constructor(
    readonly code: PolicyCode,
    message: string,
  ) {
    super(message);
    this.name = "PolicyError";
  }
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Local calendar day (YYYY-MM-DD) and minutes-since-midnight in BCC time. */
function localParts(date: Date): { day: string; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BCC_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = `${get("year")}-${get("month")}-${get("day")}`;
  const minute = Number(get("hour")) * 60 + Number(get("minute"));
  const second = Number(get("second"));
  // Fold any stray seconds into a fractional minute so slot-alignment catches them.
  return { day, minute: minute + second / 60 };
}

/**
 * Validates a requested [startISO, endISO) booking against the item's policy.
 * Throws the first PolicyError encountered; returns void when the window is
 * bookable. `now` is injectable for tests.
 *
 * Staff blocks may pass `{ bypassLeadTime: true, bypassHorizon: true }` to book
 * any date. This NEVER affects capacity — capacity is enforced separately in the
 * race-safe engine and cannot be bypassed here.
 */
export function validateBooking(
  item: ItemPolicy,
  startISO: string,
  endISO: string,
  options: PolicyOptions = {},
  now: Date = new Date(),
): void {
  const start = new Date(startISO);
  const end = new Date(endISO);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new PolicyError("slot-alignment", "Invalid start/end date");
  }

  if (!options.bypassLeadTime && start.getTime() < now.getTime() + item.leadHours * HOUR_MS) {
    throw new PolicyError(
      "lead-time",
      `Bookings require at least ${item.leadHours} hour(s) of lead time`,
    );
  }

  if (!options.bypassHorizon && start.getTime() > now.getTime() + item.horizonDays * DAY_MS) {
    throw new PolicyError(
      "horizon",
      `Bookings can be made at most ${item.horizonDays} day(s) in advance`,
    );
  }

  // Available-hours + slot alignment apply to hour-scoped items only.
  if (item.pricingUnit !== "hour" || !item.availableHours || options.bypassAvailableHours) return;
  const hc = item.availableHours;

  const s = localParts(start);
  const e = localParts(end);

  if (s.day !== e.day) {
    throw new PolicyError("available-hours", "Hourly bookings must start and end on the same day");
  }

  if (s.minute < hc.openHour * 60 || e.minute > hc.closeHour * 60) {
    throw new PolicyError(
      "available-hours",
      `Bookings must fall between ${hc.openHour}:00 and ${hc.closeHour}:00`,
    );
  }

  if (s.minute % hc.slotMinutes !== 0 || e.minute % hc.slotMinutes !== 0) {
    throw new PolicyError(
      "slot-alignment",
      `Start and end must align to ${hc.slotMinutes}-minute slots`,
    );
  }
}
