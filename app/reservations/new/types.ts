// Shared types + constants for the Add Reservation action/form.
//
// These live OUTSIDE actions.ts because a "use server" module may only export
// async functions (Next.js runtime-validates every export). Interfaces are
// erased at build time, but a plain value export like initialCreateReservationState
// trips that guard, so all non-action exports belong here.

/** One (item × occurrence) window that failed the capacity check. */
export interface ConflictLine {
  itemSlug: string;
  /** Eastern date label of the occurrence, e.g. "2026-08-01". */
  date: string;
  requested: number;
  available: number;
}

export interface CreateReservationState {
  status: "idle" | "success" | "error";
  /** Top-level message (validation error, conflict summary, or success note). */
  message?: string;
  /** Field-level validation errors keyed by a form path. */
  fieldErrors?: Record<string, string>;
  /** Populated on an all-or-nothing capacity conflict (nothing was committed). */
  conflicts?: ConflictLine[];
  /**
   * True when recurrence expansion hit a cap (horizon / max) before the rule's
   * own end condition — surfaced so the user knows occurrences were dropped.
   */
  truncated?: boolean;
  /** Count of reservation rows written on success. */
  reservationCount?: number;
}

export const initialCreateReservationState: CreateReservationState = {
  status: "idle",
};
