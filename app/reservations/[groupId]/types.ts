import { z } from "zod";

// Shared contract for the Edit Reservation page (execution-plan task P6.2, spec
// §7/§9) — Slice A. This module is CLIENT-SAFE on purpose: it carries the
// useActionState result shape, the Zod field rules, and the input/state types
// that the form UI (Slice C) and the server actions (Slice B) BOTH import, so
// the two halves cannot drift. It must therefore stay free of `server-only`,
// DB, and secret imports — the browser bundle pulls it in via the form.
//
// The field rules mirror the P6.1 Add-Reservation action
// (app/reservations/new/actions.ts) exactly: same trims, max lengths, email
// format, empty-string→undefined coercion, and the HH:MM → minutes-since-
// Eastern-midnight transform with the same end>start / within-day refinements.
// Domain rules (CLAUDE.md): time is minutes since Eastern local midnight; the
// browser sends HTML <input type="time"> "HH:MM" which we convert to minutes.

const MINUTES_PER_DAY = 24 * 60;

// ---------------------------------------------------------------------------
// Result state (shape consumed by useActionState in the edit form, Slice C)
// ---------------------------------------------------------------------------

/** One (item × occurrence) window that failed the capacity check. */
export interface ConflictLine {
  itemSlug: string;
  /** Eastern date label of the occurrence, e.g. "2026-08-01". */
  date: string;
  requested: number;
  available: number;
}

export interface EditReservationState {
  status: "idle" | "success" | "error";
  /** Top-level message (validation error, conflict summary, or success note). */
  message?: string;
  /** Field-level validation errors keyed by a form path. */
  fieldErrors?: Record<string, string>;
  /** Populated on an all-or-nothing capacity conflict (nothing was changed). */
  conflicts?: ConflictLine[];
  /** Count of reservation rows written on a successful line/date edit. */
  reservationCount?: number;
}

export const initialEditReservationState: EditReservationState = {
  status: "idle",
};

// ---------------------------------------------------------------------------
// Zod schemas shared by validation (UI hints + server-side enforcement)
// ---------------------------------------------------------------------------

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/; // HH:MM, 00:00..23:59
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Convert an HTML time "HH:MM" to minutes since local midnight (0..1439). */
export function timeToMinutes(value: string): number {
  const m = TIME_RE.exec(value);
  if (!m) throw new Error(`invalid time: ${value}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

const timeString = z
  .string()
  .regex(TIME_RE, "must be a time (HH:MM)")
  .transform(timeToMinutes);

/** Contact/notes fields — the no-capacity edit path (spec §7). */
export const contactSchema = z.object({
  contactName: z.string().trim().max(200).optional(),
  contactEmail: z
    .string()
    .trim()
    .email("invalid email")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  contactPhone: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(2000).optional(),
  title: z.string().trim().max(200).optional(),
});

export type ContactInput = z.infer<typeof contactSchema>;

/** One line item of the booking — same refinements as P6.1's lineSchema. */
export const lineSchema = z
  .object({
    itemSlug: z.string().min(1, "choose an item"),
    quantity: z.coerce.number().int("whole number").positive("must be ≥ 1"),
    date: z.string().regex(DATE_RE, "must be a date"),
    startMinute: timeString,
    endMinute: timeString,
  })
  .refine((l) => l.endMinute > l.startMinute, {
    message: "end time must be after start time",
    path: ["endMinute"],
  })
  .refine((l) => l.startMinute >= 0 && l.endMinute <= MINUTES_PER_DAY, {
    message: "time must be within one day",
    path: ["endMinute"],
  });

export type LineInput = z.infer<typeof lineSchema>;

/**
 * The capacity-affecting edit: the whole booking's new line set plus the
 * contact fields. Slice B validates a submission with this, then routes the
 * lines through scheduler.createBooking (cancel-then-rebook, spec §8).
 */
export const lineEditSchema = contactSchema.extend({
  lines: z.array(lineSchema).min(1, "add at least one line item"),
});

export type LineEditInput = z.infer<typeof lineEditSchema>;

// ---------------------------------------------------------------------------
// Delete / cancel modes (spec §9 — the two delete semantics)
// ---------------------------------------------------------------------------

/**
 * "instance" cancels just this occurrence's group rows
 * (cancelReservationsByGroup); "series" cancels the whole series
 * (cancelReservationsBySeries — future occurrences only, by default).
 */
export type DeleteMode = "instance" | "series";

export interface DeleteInput {
  mode: DeleteMode;
}
