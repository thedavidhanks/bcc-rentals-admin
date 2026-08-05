"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import {
  createReservationAction,
  initialCreateReservationState,
} from "./actions";
import styles from "./page.module.css";

// Add Reservation client form (execution-plan P6.1, spec §7).
//   • multi-product line items (add/remove rows),
//   • recurrence toggle (freq + interval + weekly weekdays + until/count),
//   • contact fields + notes,
//   • renders validation / conflict / truncation state from the action.
// All authorization + the race-safe write live on the server (actions.ts); this
// component only collects input and surfaces the result.

export interface ItemOption {
  slug: string;
  name: string;
}

const WEEKDAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
] as const;

let rowSeq = 0;
function newRowId(): number {
  return rowSeq++;
}

export function ReservationForm({
  items,
  defaultDate,
  loadError,
}: {
  items: ItemOption[];
  defaultDate?: string;
  loadError?: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    createReservationAction,
    initialCreateReservationState,
  );

  // Stable row keys so React can add/remove rows without remounting the rest.
  const [rowIds, setRowIds] = useState<number[]>(() => [newRowId()]);
  const [recurring, setRecurring] = useState(false);
  const [freq, setFreq] = useState<"daily" | "weekly" | "monthly" | "yearly">(
    "weekly",
  );
  const [endMode, setEndMode] = useState<"until" | "count">("count");

  const addRow = () => setRowIds((ids) => [...ids, newRowId()]);
  const removeRow = (id: number) =>
    setRowIds((ids) => (ids.length > 1 ? ids.filter((r) => r !== id) : ids));

  const fieldError = (path: string) => state.fieldErrors?.[path];

  return (
    <main className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.title}>Add Reservation</h1>
        <Link className={styles.navBtn} href="/calendar">
          ← Calendar
        </Link>
      </div>

      {loadError ? <p className={styles.error}>{loadError}</p> : null}

      {state.status === "error" && state.message ? (
        <p className={styles.error} role="alert">
          {state.message}
        </p>
      ) : null}

      {state.conflicts && state.conflicts.length > 0 ? (
        <div className={styles.conflictBox} role="alert">
          <strong>Unavailable — nothing was booked:</strong>
          <ul>
            {state.conflicts.map((c, i) => (
              <li key={`${c.itemSlug}-${c.date}-${i}`}>
                {c.itemSlug} on {c.date}: requested {c.requested}, {c.available}{" "}
                available
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {state.truncated ? (
        <p className={styles.warning} role="status">
          The recurrence was truncated — some later occurrences were not created
          (a cap was reached). Narrow the date range or reduce the count.
        </p>
      ) : null}

      <form action={formAction} className={styles.form}>
        <fieldset className={styles.section} disabled={pending}>
          <legend>Line items</legend>

          {rowIds.map((id, index) => (
            <div key={id} className={styles.lineRow}>
              <label className={styles.field}>
                <span>Product</span>
                <select
                  name={`line-${index}-itemSlug`}
                  defaultValue=""
                  required
                >
                  <option value="" disabled>
                    Choose a product…
                  </option>
                  {items.map((it) => (
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
                  defaultValue={1}
                  required
                  className={styles.qtyInput}
                />
              </label>

              <label className={styles.field}>
                <span>Date</span>
                <input
                  type="date"
                  name={`line-${index}-date`}
                  defaultValue={defaultDate}
                  required
                />
              </label>

              <label className={styles.field}>
                <span>Start</span>
                <input
                  type="time"
                  name={`line-${index}-startMinute`}
                  required
                />
              </label>

              <label className={styles.field}>
                <span>End</span>
                <input
                  type="time"
                  name={`line-${index}-endMinute`}
                  required
                />
              </label>

              <button
                type="button"
                className={styles.removeBtn}
                onClick={() => removeRow(id)}
                disabled={rowIds.length <= 1}
                aria-label="Remove line item"
                title="Remove line item"
              >
                ✕
              </button>
            </div>
          ))}

          {fieldError("lines") ? (
            <p className={styles.fieldError}>{fieldError("lines")}</p>
          ) : null}

          <button type="button" className={styles.addRowBtn} onClick={addRow}>
            + Add product
          </button>
        </fieldset>

        <fieldset className={styles.section} disabled={pending}>
          <legend>Recurrence</legend>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              name="recurring"
              checked={recurring}
              onChange={(e) => setRecurring(e.target.checked)}
            />
            <span>Repeat this reservation</span>
          </label>

          {recurring ? (
            <div className={styles.recurrenceControls}>
              <label className={styles.field}>
                <span>Frequency</span>
                <select
                  name="recurrence-freq"
                  value={freq}
                  onChange={(e) =>
                    setFreq(e.target.value as typeof freq)
                  }
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Annually</option>
                </select>
              </label>

              <label className={styles.field}>
                <span>Every</span>
                <input
                  type="number"
                  name="recurrence-interval"
                  min={1}
                  step={1}
                  defaultValue={1}
                  className={styles.qtyInput}
                />
              </label>

              {freq === "weekly" ? (
                <fieldset className={styles.weekdays}>
                  <legend>On weekdays</legend>
                  {WEEKDAYS.map((wd) => (
                    <label key={wd.value} className={styles.weekdayItem}>
                      <input
                        type="checkbox"
                        name="recurrence-byWeekday"
                        value={wd.value}
                      />
                      <span>{wd.label}</span>
                    </label>
                  ))}
                </fieldset>
              ) : null}

              <div className={styles.endCondition}>
                <label className={styles.checkRow}>
                  <input
                    type="radio"
                    name="recurrence-endMode"
                    value="count"
                    checked={endMode === "count"}
                    onChange={() => setEndMode("count")}
                  />
                  <span>End after</span>
                  <input
                    type="number"
                    name="recurrence-count"
                    min={1}
                    step={1}
                    defaultValue={4}
                    disabled={endMode !== "count"}
                    className={styles.qtyInput}
                  />
                  <span>occurrences</span>
                </label>
                {fieldError("recurrence.count") ? (
                  <p className={styles.fieldError}>
                    {fieldError("recurrence.count")}
                  </p>
                ) : null}

                <label className={styles.checkRow}>
                  <input
                    type="radio"
                    name="recurrence-endMode"
                    value="until"
                    checked={endMode === "until"}
                    onChange={() => setEndMode("until")}
                  />
                  <span>End on</span>
                  <input
                    type="date"
                    name="recurrence-untilDate"
                    disabled={endMode !== "until"}
                  />
                </label>
                {fieldError("recurrence.untilDate") ? (
                  <p className={styles.fieldError}>
                    {fieldError("recurrence.untilDate")}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </fieldset>

        <fieldset className={styles.section} disabled={pending}>
          <legend>Contact &amp; notes</legend>
          <div className={styles.contactGrid}>
            <label className={styles.field}>
              <span>Title</span>
              <input type="text" name="title" placeholder="e.g. Sunday service" />
            </label>
            <label className={styles.field}>
              <span>Contact name</span>
              <input type="text" name="contactName" />
            </label>
            <label className={styles.field}>
              <span>Contact email</span>
              <input type="email" name="contactEmail" />
            </label>
            <label className={styles.field}>
              <span>Contact phone</span>
              <input type="tel" name="contactPhone" />
            </label>
          </div>
          <label className={`${styles.field} ${styles.notesField}`}>
            <span>Notes</span>
            <textarea name="notes" rows={3} />
          </label>
          {fieldError("contactEmail") ? (
            <p className={styles.fieldError}>{fieldError("contactEmail")}</p>
          ) : null}
        </fieldset>

        <div className={styles.actions}>
          <button type="submit" className={styles.submitBtn} disabled={pending}>
            {pending ? "Saving…" : "Create reservation"}
          </button>
          <Link className={styles.navBtn} href="/calendar">
            Cancel
          </Link>
        </div>
      </form>
    </main>
  );
}
