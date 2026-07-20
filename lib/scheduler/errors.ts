import "server-only";

// TODO(P9): consolidate — copied from storefront lib/scheduler/errors.ts.
// The admin app is a second writer to the same reservation tables; it must throw
// the same error taxonomy the storefront does so shared handling stays aligned.

/** Base error for all scheduler failures. */
export class SchedulerError extends Error {
  constructor(
    message: string,
    readonly meta?: unknown,
  ) {
    super(message);
    this.name = "SchedulerError";
  }
}

/**
 * Requested capacity is not available for a single item over the buffered window
 * (unique item already booked, or fungible stock exhausted).
 */
export class SchedulerConflictError extends SchedulerError {
  constructor(
    message = "Reservation conflicts with an existing booking",
    meta?: unknown,
  ) {
    super(message, meta);
    this.name = "SchedulerConflictError";
  }
}

/** One (item × occurrence) window that could not be satisfied in a group booking. */
export type BookingFailure = {
  itemSlug: string;
  /** Occurrence label for reporting (e.g. the Eastern date), or null for one-offs. */
  occurrenceKey: string | null;
  startISO: string;
  endISO: string;
  requested: number;
  available: number;
};

/**
 * A multi-item / multi-occurrence booking could not be committed because one or
 * more (item × occurrence) windows lacked capacity. Carries the full list of
 * offending windows so the caller can report exactly what failed. The whole
 * booking is rolled back — nothing is committed (all-or-nothing).
 */
export class GroupBookingConflictError extends SchedulerError {
  constructor(
    readonly failures: BookingFailure[],
    message = "One or more items are unavailable for the requested window(s)",
  ) {
    super(message, { failures });
    this.name = "GroupBookingConflictError";
  }
}
