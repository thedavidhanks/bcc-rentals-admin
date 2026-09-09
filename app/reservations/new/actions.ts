"use server";
import "server-only";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireScheduler } from "@/lib/auth/guards";
import { easternInstant } from "@/lib/calendar/week";
import { withTransaction } from "@/lib/db";
import { listItems } from "@/lib/repositories/items";
import { createReservationSeries } from "@/lib/repositories/reservation-series";
import { writeAuditLog } from "@/lib/repositories/audit-log";
import { scheduler } from "@/lib/scheduler/client";
import { GroupBookingConflictError, SchedulerError } from "@/lib/scheduler/errors";
import type { BookingGroupInput } from "@/lib/scheduler/types";
import {
  expandRecurrence,
  MAX_OCCURRENCES,
  type RecurrenceFreq,
  type RecurrenceRule,
} from "@/lib/scheduler/recurrence";
import { readSubmittedValues, type SubmittedValues } from "./form-values";
import type { ConflictLine, CreateReservationState } from "./types";

// Add Reservation server action (execution-plan task P6.1, spec §7/§8/§9).
//
// The whole race-safe write runs through scheduler.createBooking (spec §8): per
// distinct item advisory lock in stable slug order → buffered-window capacity
// recheck for every (item × occurrence) → all-or-nothing insert, in ONE
// transaction. This action opens that transaction so the optional
// reservation_series row and the required admin_audit_log row (CLAUDE.md: audit
// EVERY mutation) commit atomically with the booking.
//
// Domain rules (CLAUDE.md): time is minutes since Eastern local midnight; the
// browser sends HTML <input type="time"> "HH:MM" which we convert to minutes.
// Each (Eastern civil date + minutes) becomes a real timestamptz instant via
// easternInstant (offset-correct across DST). No floats, no stored offsets.
//
// P11.9: all line items in a booking share ONE date/time window (spec §7 "the
// shared or per-item date/time window" — this app chose shared). `date`,
// `startMinute`, `endMinute` are form-level fields now, not per-line.
//
// P11.10: every error return carries `values` — the raw submitted strings
// (see ./form-values) — so a rejected save (validation failure or the routine
// capacity conflict on a busy calendar) doesn't wipe the form. `values` is
// display-only: it is never fed back into the write path, and the echoed
// itemSlugs are re-validated against the active catalog on every submit.

const MINUTES_PER_DAY = 24 * 60;

// ---------------------------------------------------------------------------
// Zod schema for the parsed form
// ---------------------------------------------------------------------------

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/; // HH:MM, 00:00..23:59
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Convert an HTML time "HH:MM" to minutes since local midnight (0..1439). */
function timeToMinutes(value: string): number {
  const m = TIME_RE.exec(value);
  if (!m) throw new Error(`invalid time: ${value}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

const timeString = z
  .string()
  .regex(TIME_RE, "must be a time (HH:MM)")
  .transform(timeToMinutes);

const lineSchema = z.object({
  itemSlug: z.string().min(1, "choose an item"),
  quantity: z.coerce.number().int("whole number").positive("must be ≥ 1"),
});

const freqSchema: z.ZodType<RecurrenceFreq> = z.enum([
  "daily",
  "weekly",
  "monthly",
  "yearly",
]);

const recurrenceSchema = z
  .object({
    freq: freqSchema,
    interval: z.coerce.number().int().positive().default(1),
    byWeekday: z.array(z.coerce.number().int().min(0).max(6)).optional(),
    endMode: z.enum(["until", "count"]),
    untilDate: z.string().regex(DATE_RE).optional(),
    count: z.coerce.number().int().positive().optional(),
  })
  .refine((r) => (r.endMode === "until" ? !!r.untilDate : true), {
    message: "provide an end date",
    path: ["untilDate"],
  })
  .refine((r) => (r.endMode === "count" ? r.count != null : true), {
    message: "provide an occurrence count",
    path: ["count"],
  });

// The shared "When" box (P11.9): one date/time window applies to every line.
const formSchema = z
  .object({
    date: z.string().regex(DATE_RE, "must be a date"),
    startMinute: timeString,
    endMinute: timeString,
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
    lines: z.array(lineSchema).min(1, "add at least one line item"),
    recurring: z.boolean().default(false),
    recurrence: recurrenceSchema.optional(),
  })
  .refine((f) => f.endMinute > f.startMinute, {
    message: "end time must be after start time",
    path: ["endMinute"],
  })
  .refine((f) => f.startMinute >= 0 && f.endMinute <= MINUTES_PER_DAY, {
    message: "time must be within one day",
    path: ["endMinute"],
  });

type ParsedForm = z.infer<typeof formSchema>;

// ---------------------------------------------------------------------------
// SubmittedValues (raw strings, see ./form-values) → Zod input shape
// ---------------------------------------------------------------------------

/**
 * Adapt the raw echoed strings into the shape formSchema validates. Mirrors
 * the old readForm()'s semantics exactly: every optional string field maps
 * "" to undefined EXCEPT contactEmail, which is passed through as-is so
 * zod's `.or(z.literal("").transform(() => undefined))` branch handles the
 * empty-string case (kept intentionally different, see actions.ts history).
 */
function toParseInput(values: SubmittedValues): unknown {
  const strOrUndef = (s: string): string | undefined => (s.length > 0 ? s : undefined);

  return {
    date: values.date,
    startMinute: values.startMinute,
    endMinute: values.endMinute,
    contactName: strOrUndef(values.contactName),
    contactEmail: values.contactEmail,
    contactPhone: strOrUndef(values.contactPhone),
    notes: strOrUndef(values.notes),
    title: strOrUndef(values.title),
    lines: values.lines.map((l) => ({ itemSlug: l.itemSlug, quantity: l.quantity })),
    recurring: values.recurring,
    recurrence: values.recurring
      ? {
          freq: values.recurrence.freq,
          interval: values.recurrence.interval,
          byWeekday: values.recurrence.byWeekday,
          endMode: values.recurrence.endMode,
          untilDate: strOrUndef(values.recurrence.untilDate),
          count: strOrUndef(values.recurrence.count),
        }
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Building booking groups
// ---------------------------------------------------------------------------

/** Build the BookingGroupInput for a single occurrence date (Eastern YYYY-MM-DD). */
function buildGroup(parsed: ParsedForm, occurrenceDate: string): BookingGroupInput {
  // P11.9: every line shares the one submitted window for this occurrence.
  const startISO = easternInstant(occurrenceDate, parsed.startMinute).toISOString();
  const endISO = easternInstant(occurrenceDate, parsed.endMinute).toISOString();

  const lines = parsed.lines.map((line) => ({
    itemSlug: line.itemSlug,
    quantity: line.quantity,
    startISO,
    endISO,
  }));

  // Anchor instant of the occurrence = the shared start time.
  const occurrenceAt = startISO;

  return {
    title: parsed.title,
    contactName: parsed.contactName,
    contactEmail: parsed.contactEmail,
    contactPhone: parsed.contactPhone,
    notes: parsed.notes,
    occurrenceKey: occurrenceDate,
    occurrenceAt,
    lines,
  };
}

// ---------------------------------------------------------------------------
// The action
// ---------------------------------------------------------------------------

export async function createReservationAction(
  _prevState: CreateReservationState,
  formData: FormData,
): Promise<CreateReservationState> {
  // a. Server-side authorization FIRST — never trust the UI (spec §3, CLAUDE.md).
  const user = await requireScheduler();

  // b. Capture the raw submission (P11.10) before/independently of validation,
  // then validate at the boundary.
  const values = readSubmittedValues(formData);
  const parsedResult = formSchema.safeParse(toParseInput(values));
  if (!parsedResult.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsedResult.error.issues) {
      fieldErrors[issue.path.join(".")] = issue.message;
    }
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors,
      values,
    };
  }
  const parsed = parsedResult.data;

  // c. Reject unknown / inactive item slugs against the active catalog.
  const activeItems = await listItems({ activeOnly: true });
  const activeSlugs = new Set(activeItems.map((i) => i.slug));
  const unknown = [
    ...new Set(parsed.lines.map((l) => l.itemSlug).filter((s) => !activeSlugs.has(s))),
  ];
  if (unknown.length > 0) {
    return {
      status: "error",
      message: `Unknown or inactive item(s): ${unknown.join(", ")}`,
      values,
    };
  }

  // e. Recurrence: expand the rule into occurrence dates (Eastern), or a single
  // one-off group. The shared date is the occurrence key for a one-off and the
  // series anchor (starts_on) for a recurring booking.
  let occurrenceDates: string[];
  let truncated = false;
  let seriesInsert: RecurrenceRule | null = null;

  if (parsed.recurring && parsed.recurrence) {
    const r = parsed.recurrence;
    const rule: RecurrenceRule = {
      freq: r.freq,
      interval: r.interval,
      byWeekday: r.byWeekday && r.byWeekday.length > 0 ? r.byWeekday : null,
      startsOn: parsed.date,
      untilDate: r.endMode === "until" ? r.untilDate ?? null : null,
      count: r.endMode === "count" ? r.count ?? null : null,
    };
    const expansion = expandRecurrence(rule, { maxOccurrences: MAX_OCCURRENCES });
    if (expansion.occurrences.length === 0) {
      return {
        status: "error",
        message: "The recurrence produced no occurrences — check the dates.",
        values,
      };
    }
    occurrenceDates = expansion.occurrences;
    truncated = expansion.truncated;
    seriesInsert = rule;
  } else {
    // One-off: a single group on the shared date.
    occurrenceDates = [parsed.date];
  }

  // f + g. Race-safe write + series + audit, all in ONE transaction.
  try {
    const result = await withTransaction(async (client) => {
      const series = seriesInsert
        ? await createReservationSeries(
            {
              freq: seriesInsert.freq,
              interval: seriesInsert.interval,
              by_weekday: seriesInsert.byWeekday ?? null,
              starts_on: seriesInsert.startsOn,
              until_date: seriesInsert.untilDate ?? null,
              count: seriesInsert.count ?? null,
              created_by: user.uid,
            },
            client,
          )
        : null;

      const groups = occurrenceDates.map((date) => buildGroup(parsed, date));

      const booking = await scheduler.createBooking(
        { createdBy: user.uid, seriesId: series?.id, groups },
        client,
      );

      await writeAuditLog(
        {
          actor_uid: user.uid,
          actor_email: user.email,
          action: "reservation.create",
          entity: "reservation_groups",
          entity_id: series?.id ?? booking.groups[0]?.id ?? null,
          detail: {
            before: null,
            after: {
              seriesId: series?.id ?? null,
              recurring: parsed.recurring,
              occurrences: occurrenceDates,
              groupIds: booking.groups.map((g) => g.id),
              reservationCount: booking.reservationCount,
              items: [...new Set(parsed.lines.map((l) => l.itemSlug))],
            },
          },
        },
        client,
      );

      return booking;
    });

    // h. Success — refresh the calendar and navigate there.
    revalidatePath("/calendar");
    redirect("/calendar");

    // Unreachable (redirect throws), but keeps the return type honest.
    return {
      status: "success",
      reservationCount: result.reservationCount,
      truncated,
    };
  } catch (err) {
    // redirect() throws a control-flow signal — let it propagate.
    if (isRedirectError(err)) throw err;

    if (err instanceof GroupBookingConflictError) {
      const conflicts: ConflictLine[] = err.failures.map((f) => ({
        itemSlug: f.itemSlug,
        date: f.occurrenceKey ?? "(unspecified)",
        requested: f.requested,
        available: f.available,
      }));
      return {
        status: "error",
        message:
          "Some items are unavailable for the requested window(s). Nothing was booked.",
        conflicts,
        truncated,
        values,
      };
    }

    if (err instanceof SchedulerError) {
      return { status: "error", message: err.message, truncated, values };
    }

    return {
      status: "error",
      message: "Could not create the reservation. Please try again.",
      truncated,
      values,
    };
  }
}

/** Next's redirect() throws a special error we must re-throw, not swallow. */
function isRedirectError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}
