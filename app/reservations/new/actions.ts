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

const lineSchema = z
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

const formSchema = z.object({
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
});

type ParsedForm = z.infer<typeof formSchema>;

// ---------------------------------------------------------------------------
// FormData → structured input
// ---------------------------------------------------------------------------

/**
 * Read the flat FormData the client form submits into the nested shape the Zod
 * schema validates. Line-item fields are named `line-<i>-<field>` (contiguous
 * indices are not required — we collect by scanning the present keys).
 */
function readForm(formData: FormData): unknown {
  const str = (k: string): string | undefined => {
    const v = formData.get(k);
    return typeof v === "string" && v.length > 0 ? v : undefined;
  };

  // Collect line indices present in the payload.
  const lineIndices = new Set<number>();
  for (const key of formData.keys()) {
    const m = /^line-(\d+)-/.exec(key);
    if (m) lineIndices.add(Number(m[1]));
  }
  const lines = [...lineIndices]
    .sort((a, b) => a - b)
    .map((i) => ({
      itemSlug: str(`line-${i}-itemSlug`) ?? "",
      quantity: str(`line-${i}-quantity`) ?? "1",
      date: str(`line-${i}-date`) ?? "",
      startMinute: str(`line-${i}-startMinute`) ?? "",
      endMinute: str(`line-${i}-endMinute`) ?? "",
    }));

  const recurring = formData.get("recurring") === "on" || formData.get("recurring") === "true";

  const recurrence = recurring
    ? {
        freq: str("recurrence-freq") ?? "weekly",
        interval: str("recurrence-interval") ?? "1",
        byWeekday: formData.getAll("recurrence-byWeekday").map((v) => String(v)),
        endMode: str("recurrence-endMode") ?? "count",
        untilDate: str("recurrence-untilDate"),
        count: str("recurrence-count"),
      }
    : undefined;

  return {
    contactName: str("contactName"),
    contactEmail: formData.get("contactEmail") ?? undefined,
    contactPhone: str("contactPhone"),
    notes: str("notes"),
    title: str("title"),
    lines,
    recurring,
    recurrence,
  };
}

// ---------------------------------------------------------------------------
// Building booking groups
// ---------------------------------------------------------------------------

/** Build the BookingGroupInput for a single occurrence date (Eastern YYYY-MM-DD). */
function buildGroup(
  parsed: ParsedForm,
  occurrenceDate: string,
  perLineDate: boolean,
): BookingGroupInput {
  const lines = parsed.lines.map((line) => {
    // For a one-off, honor each line's own date; for a recurring series every
    // line shares the occurrence's date (the per-line dates seed the series).
    const date = perLineDate ? line.date : occurrenceDate;
    return {
      itemSlug: line.itemSlug,
      quantity: line.quantity,
      startISO: easternInstant(date, line.startMinute).toISOString(),
      endISO: easternInstant(date, line.endMinute).toISOString(),
    };
  });

  // Anchor instant of the occurrence = earliest line start on that date.
  const earliestStart = Math.min(...parsed.lines.map((l) => l.startMinute));
  const occurrenceAt = easternInstant(occurrenceDate, earliestStart).toISOString();

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

  // b. Validate at the boundary.
  const parsedResult = formSchema.safeParse(readForm(formData));
  if (!parsedResult.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsedResult.error.issues) {
      fieldErrors[issue.path.join(".")] = issue.message;
    }
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors,
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
    };
  }

  // e. Recurrence: expand the rule into occurrence dates (Eastern), or a single
  // one-off group. For a one-off each line keeps its own date/time window.
  let occurrenceDates: string[];
  let truncated = false;
  let perLineDate = false;
  let seriesInsert: RecurrenceRule | null = null;

  if (parsed.recurring && parsed.recurrence) {
    const r = parsed.recurrence;
    // The series anchors on the first line's date (the earliest chosen date).
    const startsOn = [...parsed.lines.map((l) => l.date)].sort()[0];
    const rule: RecurrenceRule = {
      freq: r.freq,
      interval: r.interval,
      byWeekday: r.byWeekday && r.byWeekday.length > 0 ? r.byWeekday : null,
      startsOn,
      untilDate: r.endMode === "until" ? r.untilDate ?? null : null,
      count: r.endMode === "count" ? r.count ?? null : null,
    };
    const expansion = expandRecurrence(rule, { maxOccurrences: MAX_OCCURRENCES });
    if (expansion.occurrences.length === 0) {
      return {
        status: "error",
        message: "The recurrence produced no occurrences — check the dates.",
      };
    }
    occurrenceDates = expansion.occurrences;
    truncated = expansion.truncated;
    seriesInsert = rule;
  } else {
    // One-off: one group; per-line dates apply. Use the earliest date as the key.
    occurrenceDates = [[...parsed.lines.map((l) => l.date)].sort()[0]];
    perLineDate = true;
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

      const groups = occurrenceDates.map((date) =>
        buildGroup(parsed, date, perLineDate),
      );

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
      };
    }

    if (err instanceof SchedulerError) {
      return { status: "error", message: err.message, truncated };
    }

    return {
      status: "error",
      message: "Could not create the reservation. Please try again.",
      truncated,
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
