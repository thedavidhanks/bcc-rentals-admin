"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  deleteReservationAction,
  editLinesAction,
  updateContactAction,
} from "./actions";
import type { LoadedReservation } from "./loader";
import { initialEditReservationState, type ConflictLine } from "./types";
import styles from "./page.module.css";

// Edit Reservation client form (execution-plan P6.2, spec §7/§9).
//   • loads all line items of a booking together, pre-filled from the group's
//     reservation rows (item slug + Eastern date/start/end derived from the
//     stored instants),
//   • contact fields + notes + title pre-filled from the reservation_group,
//   • read-only recurrence summary when the booking is part of a series,
//   • three server actions: contact-only save (no capacity impact), line/date
//     edit (cancel-then-rebook via the race-safe engine), and delete/cancel.
// All authorization + the race-safe write live on the server (actions.ts); this
// component only collects input, confirms destructive actions, and surfaces the
// result (field errors, top-level message, and the conflict list).

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const FREQ_LABELS: Record<string, string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  yearly: "year",
};

// ---------------------------------------------------------------------------
// Eastern date/time derivation from stored instants
// ---------------------------------------------------------------------------
// reservation.start_at/end_at are real instants (timestamptz → JS Date). The
// form's <input type="date"> wants "YYYY-MM-DD" and <input type="time"> wants
// "HH:MM", both in Eastern civil time (minutes since Eastern midnight is the
// domain convention). We format each instant in America/New_York and read the
// parts back — mirroring how the calendar renders Eastern (Intl + timeZone).

const easternDateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const easternTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "YYYY-MM-DD" in Eastern for a date input. */
function easternDate(instant: Date): string {
  // en-CA formats as YYYY-MM-DD, exactly what <input type="date"> expects.
  return easternDateFmt.format(instant);
}

/** "HH:MM" in Eastern for a time input. */
function easternTime(instant: Date): string {
  // en-GB 24h formats as HH:MM (may emit "24:00" for exact midnight on some
  // engines — normalize to "00:00" for a valid <input type="time"> value).
  const t = easternTimeFmt.format(instant);
  return t === "24:00" ? "00:00" : t;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReservationEditForm({
  loaded,
  loadError,
}: {
  loaded: LoadedReservation | null;
  loadError?: string | null;
}) {
  const [contactState, contactAction, contactPending] = useActionState(
    updateContactAction,
    initialEditReservationState,
  );
  const [linesState, linesFormAction, linesPending] = useActionState(
    editLinesAction,
    initialEditReservationState,
  );
  const [deleteState, deleteFormAction, deletePending] = useActionState(
    deleteReservationAction,
    initialEditReservationState,
  );

  // The load failed (DB down) — surface it and stop; there is nothing to edit.
  if (!loaded) {
    return (
      <main className={styles.page}>
        <div className={styles.toolbar}>
          <h1 className={styles.title}>Edit Reservation</h1>
          <Link className={styles.navBtn} href="/calendar">
            ← Calendar
          </Link>
        </div>
        <p className={styles.error} role="alert">
          {loadError ?? "Could not load the reservation."}
        </p>
      </main>
    );
  }

  const { group, reservations, series, seriesReservations, items, itemSlugById } =
    loaded;

  const groupId = group.id;
  const isSeries = Boolean(group.series_id && series);
  const allCancelled =
    reservations.length > 0 &&
    reservations.every((r) => r.status === "cancelled");

  // Pre-fill each line from its reservation row. item_id → slug via the loader's
  // full-catalog map; Eastern date/times derived from the stored instants.
  const lines = reservations.map((r) => ({
    id: r.id,
    itemSlug: itemSlugById[r.item_id] ?? "",
    quantity: r.quantity,
    date: easternDate(r.start_at),
    startMinute: easternTime(r.start_at),
    endMinute: easternTime(r.end_at),
    status: r.status,
  }));

  // If a line's current slug is inactive (not in the active catalog), keep it
  // selectable so editing a booking with a now-inactive item doesn't lose it.
  const activeSlugs = new Set(items.map((i) => i.slug));
  const optionsFor = (slug: string) => {
    if (slug && !activeSlugs.has(slug)) {
      return [{ slug, name: `${slug} (inactive)` }, ...items];
    }
    return items;
  };

  const contactFieldError = (path: string) => contactState.fieldErrors?.[path];
  const linesFieldError = (path: string) => linesState.fieldErrors?.[path];

  return (
    <main className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.title}>
          Edit Reservation
          {group.title ? <span className={styles.rangeLabel}>{group.title}</span> : null}
        </h1>
        <Link className={styles.navBtn} href="/calendar">
          ← Calendar
        </Link>
      </div>

      {loadError ? (
        <p className={styles.error} role="alert">
          {loadError}
        </p>
      ) : null}

      {allCancelled ? (
        <p className={styles.cancelledBanner} role="status">
          This booking is <strong>cancelled</strong>. It is shown for history —
          re-saving the line items will re-book the freed capacity.
        </p>
      ) : null}

      {isSeries && series ? (
        <div className={styles.seriesSummary} role="note">
          <strong>Part of a recurring series.</strong>{" "}
          <RecurrenceSummary
            freq={series.freq}
            interval={series.interval}
            byWeekday={series.by_weekday}
          />{" "}
          <span className={styles.seriesCount}>
            {series.count != null
              ? `${series.count} occurrence${series.count === 1 ? "" : "s"}`
              : `${seriesReservations.length} occurrence row${
                  seriesReservations.length === 1 ? "" : "s"
                }`}
            {series.until_date ? ` · until ${series.until_date}` : ""}
          </span>
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* Line items / dates / times — cancel-then-rebook (capacity impact)  */}
      {/* ------------------------------------------------------------------ */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Line items</h2>

        {linesState.status === "error" && linesState.message ? (
          <p className={styles.error} role="alert">
            {linesState.message}
          </p>
        ) : null}

        {linesState.status === "success" && linesState.message ? (
          <p className={styles.success} role="status">
            {linesState.message}
          </p>
        ) : null}

        {linesState.conflicts && linesState.conflicts.length > 0 ? (
          <ConflictBox conflicts={linesState.conflicts} />
        ) : null}

        <form
          action={linesFormAction}
          className={styles.form}
          onSubmit={(e) => {
            if (
              !window.confirm(
                "Save line item changes? The existing booking will be cancelled and re-booked; if the new window is full nothing changes.",
              )
            ) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="groupId" value={groupId} />

          <fieldset className={styles.section} disabled={linesPending}>
            <legend>Products &amp; times</legend>

            {lines.map((line, index) => (
              <div key={line.id} className={styles.lineRow}>
                <label className={styles.field}>
                  <span>Product</span>
                  <select
                    name={`line-${index}-itemSlug`}
                    defaultValue={line.itemSlug}
                    required
                  >
                    <option value="" disabled>
                      Choose a product…
                    </option>
                    {optionsFor(line.itemSlug).map((it) => (
                      <option key={it.slug} value={it.slug}>
                        {it.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={styles.field}>
                  <span>Qty</span>
                  <input
                    type="number"
                    name={`line-${index}-quantity`}
                    min={1}
                    step={1}
                    defaultValue={line.quantity}
                    required
                    className={styles.qtyInput}
                  />
                </label>

                <label className={styles.field}>
                  <span>Date</span>
                  <input
                    type="date"
                    name={`line-${index}-date`}
                    defaultValue={line.date}
                    required
                  />
                </label>

                <label className={styles.field}>
                  <span>Start</span>
                  <input
                    type="time"
                    name={`line-${index}-startMinute`}
                    defaultValue={line.startMinute}
                    required
                  />
                </label>

                <label className={styles.field}>
                  <span>End</span>
                  <input
                    type="time"
                    name={`line-${index}-endMinute`}
                    defaultValue={line.endMinute}
                    required
                  />
                </label>

                {linesFieldError(`lines.${index}.endMinute`) ? (
                  <p className={styles.fieldError}>
                    {linesFieldError(`lines.${index}.endMinute`)}
                  </p>
                ) : null}
                {linesFieldError(`lines.${index}.itemSlug`) ? (
                  <p className={styles.fieldError}>
                    {linesFieldError(`lines.${index}.itemSlug`)}
                  </p>
                ) : null}
                {linesFieldError(`lines.${index}.quantity`) ? (
                  <p className={styles.fieldError}>
                    {linesFieldError(`lines.${index}.quantity`)}
                  </p>
                ) : null}
              </div>
            ))}

            {linesFieldError("lines") ? (
              <p className={styles.fieldError}>{linesFieldError("lines")}</p>
            ) : null}
          </fieldset>

          {/* The line edit carries the contact fields too so a single submit is
              self-contained (editLinesAction reads both). Kept editable here. */}
          <fieldset className={styles.section} disabled={linesPending}>
            <legend>Contact &amp; notes (saved with line changes)</legend>
            <ContactFields group={group} idPrefix="lines" />
            {linesFieldError("contactEmail") ? (
              <p className={styles.fieldError}>
                {linesFieldError("contactEmail")}
              </p>
            ) : null}
          </fieldset>

          <div className={styles.actions}>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={linesPending}
            >
              {linesPending ? "Saving…" : "Save line items"}
            </button>
          </div>
        </form>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Contact-only save (no capacity impact)                             */}
      {/* ------------------------------------------------------------------ */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Contact &amp; notes only</h2>
        <p className={styles.hint}>
          Update contact details or notes without touching dates, items, or times.
        </p>

        {contactState.status === "error" && contactState.message ? (
          <p className={styles.error} role="alert">
            {contactState.message}
          </p>
        ) : null}

        {contactState.status === "success" && contactState.message ? (
          <p className={styles.success} role="status">
            {contactState.message}
          </p>
        ) : null}

        <form action={contactAction} className={styles.form}>
          <input type="hidden" name="groupId" value={groupId} />
          <fieldset className={styles.section} disabled={contactPending}>
            <legend>Contact &amp; notes</legend>
            <ContactFields group={group} idPrefix="contact" />
            {contactFieldError("contactEmail") ? (
              <p className={styles.fieldError}>
                {contactFieldError("contactEmail")}
              </p>
            ) : null}
          </fieldset>
          <div className={styles.actions}>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={contactPending}
            >
              {contactPending ? "Saving…" : "Save contact & notes"}
            </button>
          </div>
        </form>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Delete / cancel (spec §9 — instance vs series)                     */}
      {/* ------------------------------------------------------------------ */}
      <section className={`${styles.section} ${styles.deleteSection}`}>
        <h2 className={styles.sectionTitle}>Cancel this booking</h2>
        <p className={styles.hint}>
          Cancelling sets the status to <code>cancelled</code> (kept for history)
          and frees the capacity. This cannot be undone from here.
        </p>

        {deleteState.status === "error" && deleteState.message ? (
          <p className={styles.error} role="alert">
            {deleteState.message}
          </p>
        ) : null}

        {deleteState.status === "success" && deleteState.message ? (
          <p className={styles.success} role="status">
            {deleteState.message}
          </p>
        ) : null}

        <div className={styles.deleteActions}>
          <form
            action={deleteFormAction}
            onSubmit={(e) => {
              if (
                !window.confirm(
                  isSeries
                    ? "Cancel just THIS occurrence's booking? Other occurrences in the series are unaffected."
                    : "Cancel this booking? This sets it to cancelled and frees the capacity.",
                )
              ) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="groupId" value={groupId} />
            <input type="hidden" name="mode" value="instance" />
            <button
              type="submit"
              className={styles.dangerBtn}
              disabled={deletePending}
            >
              {deletePending ? "Cancelling…" : isSeries ? "Cancel this instance" : "Cancel this booking"}
            </button>
          </form>

          {isSeries ? (
            <form
              action={deleteFormAction}
              onSubmit={(e) => {
                if (
                  !window.confirm(
                    "Cancel the WHOLE series? All occurrences (typically future ones) will be cancelled.",
                  )
                ) {
                  e.preventDefault();
                }
              }}
            >
              <input type="hidden" name="groupId" value={groupId} />
              <input type="hidden" name="mode" value="series" />
              <button
                type="submit"
                className={styles.dangerBtn}
                disabled={deletePending}
              >
                {deletePending ? "Cancelling…" : "Cancel the whole series"}
              </button>
            </form>
          ) : null}
        </div>
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function ContactFields({
  group,
  idPrefix,
}: {
  group: LoadedReservation["group"];
  idPrefix: string;
}) {
  return (
    <>
      <div className={styles.contactGrid}>
        <label className={styles.field}>
          <span>Title</span>
          <input
            type="text"
            name="title"
            defaultValue={group.title ?? ""}
            placeholder="e.g. Sunday service"
          />
        </label>
        <label className={styles.field}>
          <span>Contact name</span>
          <input
            type="text"
            name="contactName"
            defaultValue={group.contact_name ?? ""}
          />
        </label>
        <label className={styles.field}>
          <span>Contact email</span>
          <input
            type="email"
            name="contactEmail"
            defaultValue={group.contact_email ?? ""}
          />
        </label>
        <label className={styles.field}>
          <span>Contact phone</span>
          <input
            type="tel"
            name="contactPhone"
            defaultValue={group.contact_phone ?? ""}
          />
        </label>
      </div>
      <label
        className={`${styles.field} ${styles.notesField}`}
        key={`${idPrefix}-notes`}
      >
        <span>Notes</span>
        <textarea name="notes" rows={3} defaultValue={group.notes ?? ""} />
      </label>
    </>
  );
}

function RecurrenceSummary({
  freq,
  interval,
  byWeekday,
}: {
  freq: string;
  interval: number;
  byWeekday: number[] | null;
}) {
  const unit = FREQ_LABELS[freq] ?? freq;
  const every =
    interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;
  const days =
    byWeekday && byWeekday.length > 0
      ? ` on ${byWeekday.map((d) => WEEKDAY_LABELS[d] ?? d).join(", ")}`
      : "";
  return (
    <span>
      {every}
      {days}.
    </span>
  );
}

function ConflictBox({ conflicts }: { conflicts: ConflictLine[] }) {
  return (
    <div className={styles.conflictBox} role="alert">
      <strong>Unavailable — nothing was changed:</strong>
      <ul>
        {conflicts.map((c, i) => (
          <li key={`${c.itemSlug}-${c.date}-${i}`}>
            {c.itemSlug} on {c.date}: requested {c.requested}, {c.available}{" "}
            available
          </li>
        ))}
      </ul>
    </div>
  );
}
