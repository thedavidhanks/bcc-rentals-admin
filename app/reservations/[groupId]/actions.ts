"use server";
import "server-only";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireScheduler } from "@/lib/auth/guards";
import { easternInstant } from "@/lib/calendar/week";
import { withTransaction } from "@/lib/db";
import { writeAuditLog } from "@/lib/repositories/audit-log";
import {
  getReservationGroupById,
  updateReservationGroup,
} from "@/lib/repositories/reservation-groups";
import {
  cancelReservationsByGroup,
  cancelReservationsBySeries,
  listReservationsByGroup,
  updateReservationContact,
} from "@/lib/repositories/reservations";
import { scheduler } from "@/lib/scheduler/client";
import { GroupBookingConflictError, SchedulerError } from "@/lib/scheduler/errors";
import type { BookingGroupInput } from "@/lib/scheduler/types";

import {
  contactSchema,
  lineEditSchema,
  type ConflictLine,
  type EditReservationState,
} from "./types";

// Edit Reservation server actions (execution-plan task P6.2, spec §7/§8/§9) —
// Slice B. Three distinct mutations on an existing booking, all keyed by
// group_id (passed as a hidden form field). Every action:
//   • authorizes on the server FIRST via requireScheduler() — never trust the UI
//     (spec §3, CLAUDE.md);
//   • validates its input at the boundary with the shared Zod schemas from
//     ./types, returning fieldErrors on failure;
//   • runs the mutation AND its admin_audit_log row in ONE withTransaction
//     (CLAUDE.md: audit every mutation, atomically);
//   • re-throws Next's redirect() control-flow signal (see isRedirectError);
//   • revalidates the calendar + this booking's page on success.
//
// Domain rules (CLAUDE.md): time is minutes since Eastern local midnight; the
// shared lineSchema OUTPUTS startMinute/endMinute as minutes, and each (Eastern
// civil date + minutes) becomes a real timestamptz instant via easternInstant
// (offset-correct across DST). No floats, no stored offsets. "Cancel, never
// DELETE" — cancels set status='cancelled', which frees capacity via the partial
// index.

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

/** Read a non-empty string form field, or undefined. */
function str(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Read + validate the required hidden groupId field. */
function readGroupId(formData: FormData): string | null {
  const v = formData.get("groupId");
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Convert Zod issues into the fieldErrors map (path joined by "."). */
function toFieldErrors(
  issues: { path: (string | number)[]; message: string }[],
): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    fieldErrors[issue.path.join(".")] = issue.message;
  }
  return fieldErrors;
}

/** Read the flat contact FormData fields into the contactSchema input shape. */
function readContactForm(formData: FormData): unknown {
  return {
    contactName: str(formData, "contactName"),
    // Pass the raw email through (empty string → schema coerces to undefined) so
    // an invalid email is reported rather than silently dropped.
    contactEmail: formData.get("contactEmail") ?? undefined,
    contactPhone: str(formData, "contactPhone"),
    notes: str(formData, "notes"),
    title: str(formData, "title"),
  };
}

/**
 * Read the flat line-edit FormData (contact fields + `line-<i>-<field>`) into
 * the lineEditSchema input shape. Mirrors P6.1's readForm line collection: scan
 * present keys for line indices (contiguity not required).
 */
function readLineEditForm(formData: FormData): unknown {
  const lineIndices = new Set<number>();
  for (const key of formData.keys()) {
    const m = /^line-(\d+)-/.exec(key);
    if (m) lineIndices.add(Number(m[1]));
  }
  const lines = [...lineIndices]
    .sort((a, b) => a - b)
    .map((i) => ({
      itemSlug: str(formData, `line-${i}-itemSlug`) ?? "",
      quantity: str(formData, `line-${i}-quantity`) ?? "1",
      date: str(formData, `line-${i}-date`) ?? "",
      startMinute: str(formData, `line-${i}-startMinute`) ?? "",
      endMinute: str(formData, `line-${i}-endMinute`) ?? "",
    }));

  return {
    ...(readContactForm(formData) as Record<string, unknown>),
    lines,
  };
}

// ===========================================================================
// 1. updateContactAction — §2.2 contact/notes/title edit (NO booking engine)
// ===========================================================================
//
// Editing contact name/email/phone, notes, and title does NOT change any time
// window, so it must NOT go through the race-safe booking engine. It updates the
// reservation_groups row AND every reservation row in the group: the group row
// is the booking's canonical contact, but each reservation row also carries a
// copy of the contact (mirroring the storefront's per-row customer_* columns)
// which the calendar tooltip reads — so both must stay in sync.
export async function updateContactAction(
  _prevState: EditReservationState,
  formData: FormData,
): Promise<EditReservationState> {
  const user = await requireScheduler();

  const groupId = readGroupId(formData);
  if (!groupId) {
    return { status: "error", message: "Missing reservation reference." };
  }

  const parsed = contactSchema.safeParse(readContactForm(formData));
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: toFieldErrors(parsed.error.issues),
    };
  }
  const c = parsed.data;

  const existing = await getReservationGroupById(groupId);
  if (!existing) {
    return { status: "error", message: "That reservation no longer exists." };
  }

  try {
    await withTransaction(async (client) => {
      // Group row: the canonical booking contact + title + notes.
      await updateReservationGroup(
        groupId,
        {
          title: c.title ?? null,
          contact_name: c.contactName ?? null,
          contact_email: c.contactEmail ?? null,
          contact_phone: c.contactPhone ?? null,
          notes: c.notes ?? null,
        },
        client,
      );

      // Reservation rows: keep each row's contact copy in sync (calendar tooltip
      // reads the row, not the group). Title has no per-row column, so it is not
      // propagated to the rows.
      const rows = await listReservationsByGroup(groupId, client);
      for (const row of rows) {
        await updateReservationContact(
          row.id,
          {
            customer_name: c.contactName ?? null,
            customer_email: c.contactEmail ?? null,
            customer_phone: c.contactPhone ?? null,
            notes: c.notes ?? null,
          },
          client,
        );
      }

      await writeAuditLog(
        {
          actor_uid: user.uid,
          actor_email: user.email,
          action: "reservation.update_contact",
          entity: "reservation_groups",
          entity_id: groupId,
          detail: {
            before: {
              title: existing.title,
              contactName: existing.contact_name,
              contactEmail: existing.contact_email,
              contactPhone: existing.contact_phone,
              notes: existing.notes,
            },
            after: {
              title: c.title ?? null,
              contactName: c.contactName ?? null,
              contactEmail: c.contactEmail ?? null,
              contactPhone: c.contactPhone ?? null,
              notes: c.notes ?? null,
            },
          },
        },
        client,
      );
    });
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return {
      status: "error",
      message: "Could not update the reservation. Please try again.",
    };
  }

  // Stay on the page so the user sees confirmation (mirror P6.1's success feel,
  // but no redirect for a contact edit — spec §2.2).
  revalidatePath("/calendar");
  revalidatePath(`/reservations/${groupId}`);
  return { status: "success", message: "Contact details saved." };
}

// ===========================================================================
// 2. editLinesAction — §2.3 line/date/time edit via CANCEL-THEN-REBOOK
// ===========================================================================
//
// !!! DO NOT "OPTIMIZE" THIS INTO A PLAIN UPDATE OF dates/items/quantities. !!!
//
// Changing an item, quantity, date, or start/end time changes what capacity is
// occupied. A naive UPDATE of the reservation rows would bypass the §8 race-safe
// path (advisory lock → buffered-window capacity recheck → insert) and can
// double-book the shared production tables — a staff block and a customer
// booking could both claim the last unit. The ONLY correct way to move capacity
// is through scheduler.createBooking. So this edit is CANCEL-THEN-REBOOK inside
// ONE transaction:
//   a. cancelReservationsByGroup(oldGroupId, client) — frees the old capacity
//      WITHIN the txn, so the recheck in (b) correctly sees it freed (no false
//      self-conflict against the row we're editing).
//   b. scheduler.createBooking(...) — re-acquires the per-item advisory locks and
//      re-checks capacity for the NEW window(s), all-or-nothing.
//   c. writeAuditLog — atomic with the mutation.
// On GroupBookingConflictError the whole transaction rolls back: the ORIGINAL
// booking is left completely intact and we surface the conflict lines to the UI.
//
// CONSEQUENCE — NEW group_id: cancel-then-rebook cancels the old group's rows and
// createBooking inserts a BRAND-NEW reservation_groups row, so the edited booking
// gets a NEW group_id (the old group id lives on only as cancelled history). This
// is acceptable and intentional (spec §8 race safety wins over id stability); the
// series_id linkage IS preserved so a series occurrence stays attached.
export async function editLinesAction(
  _prevState: EditReservationState,
  formData: FormData,
): Promise<EditReservationState> {
  const user = await requireScheduler();

  const groupId = readGroupId(formData);
  if (!groupId) {
    return { status: "error", message: "Missing reservation reference." };
  }

  const parsed = lineEditSchema.safeParse(readLineEditForm(formData));
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: toFieldErrors(parsed.error.issues),
    };
  }
  const data = parsed.data;

  // Load the existing group first — need its series_id to preserve linkage.
  const existing = await getReservationGroupById(groupId);
  if (!existing) {
    return { status: "error", message: "That reservation no longer exists." };
  }

  // Build ONE BookingGroupInput from the new line set. Occurrence anchor/key =
  // earliest line start (mirrors P6.1's buildGroup). Each line's (Eastern date +
  // minutes) → offset-correct timestamptz ISO via easternInstant.
  const earliestStart = Math.min(...data.lines.map((l) => l.startMinute));
  const earliestDate = [...data.lines.map((l) => l.date)].sort()[0];
  const occurrenceAt = easternInstant(earliestDate, earliestStart).toISOString();

  const newGroup: BookingGroupInput = {
    title: data.title,
    contactName: data.contactName,
    contactEmail: data.contactEmail,
    contactPhone: data.contactPhone,
    notes: data.notes,
    occurrenceKey: earliestDate,
    occurrenceAt,
    lines: data.lines.map((line) => ({
      itemSlug: line.itemSlug,
      quantity: line.quantity,
      startISO: easternInstant(line.date, line.startMinute).toISOString(),
      endISO: easternInstant(line.date, line.endMinute).toISOString(),
    })),
  };

  try {
    await withTransaction(async (client) => {
      // a. Free the old capacity inside the txn (cancel, never DELETE).
      await cancelReservationsByGroup(groupId, client);

      // b. Rebook the new window(s) through the race-safe engine, preserving the
      //    series linkage so a series occurrence stays attached.
      const booking = await scheduler.createBooking(
        {
          createdBy: user.uid,
          seriesId: existing.series_id ?? undefined,
          groups: [newGroup],
        },
        client,
      );

      // c. Audit — atomic with the cancel + rebook.
      await writeAuditLog(
        {
          actor_uid: user.uid,
          actor_email: user.email,
          action: "reservation.edit_lines",
          entity: "reservation_groups",
          entity_id: booking.groups[0]?.id ?? groupId,
          detail: {
            before: {
              groupId,
              seriesId: existing.series_id,
              items: [...new Set(data.lines.map((l) => l.itemSlug))],
            },
            after: {
              groupIds: booking.groups.map((g) => g.id),
              seriesId: existing.series_id,
              reservationCount: booking.reservationCount,
              items: [...new Set(data.lines.map((l) => l.itemSlug))],
            },
          },
        },
        client,
      );
    });
  } catch (err) {
    if (isRedirectError(err)) throw err;

    if (err instanceof GroupBookingConflictError) {
      // The txn rolled back — the original booking is intact, nothing changed.
      const conflicts: ConflictLine[] = err.failures.map((f) => ({
        itemSlug: f.itemSlug,
        date: f.occurrenceKey ?? "(unspecified)",
        requested: f.requested,
        available: f.available,
      }));
      return {
        status: "error",
        message:
          "Some items are unavailable for the requested window(s). Nothing was changed.",
        conflicts,
      };
    }

    if (err instanceof SchedulerError) {
      return { status: "error", message: err.message };
    }

    return {
      status: "error",
      message: "Could not save the changes. Nothing was changed.",
    };
  }

  // Success — refresh the calendar and navigate there (mirror P6.1). The old
  // /reservations/${groupId} page is now cancelled history; revalidate it too.
  revalidatePath("/calendar");
  revalidatePath(`/reservations/${groupId}`);
  redirect("/calendar");
}

// ===========================================================================
// 3. deleteReservationAction — §2.4 delete/cancel (two modes, spec §9)
// ===========================================================================
//
// Deleting = set status='cancelled' (NEVER DELETE rows — keeps history + frees
// capacity via the partial index). Two modes:
//   • "instance": cancel just this occurrence's group rows.
//   • "series":  cancel the whole series. cancelReservationsBySeries defaults to
//                FUTURE-ONLY scoping (start_at >= now) — past occurrences are
//                intentionally kept as history per spec §9 ("typically only
//                future occurrences; leave past ones as history"). We rely on the
//                repo default; we never pass includePast here.
export async function deleteReservationAction(
  _prevState: EditReservationState,
  formData: FormData,
): Promise<EditReservationState> {
  const user = await requireScheduler();

  const groupId = readGroupId(formData);
  if (!groupId) {
    return { status: "error", message: "Missing reservation reference." };
  }

  const mode = formData.get("mode");
  if (mode !== "instance" && mode !== "series") {
    return { status: "error", message: "Choose what to cancel." };
  }

  const existing = await getReservationGroupById(groupId);
  if (!existing) {
    return { status: "error", message: "That reservation no longer exists." };
  }

  if (mode === "series" && !existing.series_id) {
    return {
      status: "error",
      message: "This booking is not part of a series.",
    };
  }

  try {
    await withTransaction(async (client) => {
      let cancelledCount: number;
      if (mode === "series") {
        // Future-only by default (repo scopes to start_at >= now); past
        // occurrences are kept as history (spec §9).
        cancelledCount = await cancelReservationsBySeries(
          existing.series_id as string,
          {},
          client,
        );
      } else {
        cancelledCount = await cancelReservationsByGroup(groupId, client);
      }

      await writeAuditLog(
        {
          actor_uid: user.uid,
          actor_email: user.email,
          action: "reservation.cancel",
          entity: "reservation_groups",
          entity_id: groupId,
          detail: {
            before: { status: "active" },
            after: {
              status: "cancelled",
              mode,
              seriesId: mode === "series" ? existing.series_id : null,
              cancelledCount,
              // Series cancels are future-only (past kept as history, spec §9).
              scope: mode === "series" ? "future-only" : "group",
            },
          },
        },
        client,
      );
    });
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return {
      status: "error",
      message: "Could not cancel the reservation. Please try again.",
    };
  }

  revalidatePath("/calendar");
  revalidatePath(`/reservations/${groupId}`);
  redirect("/calendar");
}
