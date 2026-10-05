"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";

import { createReservationAction } from "./actions";
import { EMPTY_SUBMITTED_VALUES, type SubmittedValues } from "./form-values";
import { initialCreateReservationState, type CreateReservationState } from "./types";
import styles from "./page.module.css";

// Add Reservation client form (execution-plan P6.1, spec §7).
//   • one shared Date/Start/End window for the whole booking (P11.9) — all
//     line items are reserved for the same window; recurrence controls live
//     inside the same "When" box,
//   • multi-product line items (add/remove rows),
//   • contact fields + notes,
//   • renders validation / conflict / truncation state from the action.
// All authorization + the race-safe write live on the server (actions.ts); this
// component only collects input and surfaces the result.
//
// P11.10 — every field below is a CONTROLLED input (value + onChange off the
// local `values` state), never `defaultValue`. This is deliberate: React
// resets uncontrolled form fields after a Server Action submission completes,
// which would wipe whatever the user typed on a rejected save (a validation
// slip, or the all-or-nothing capacity conflict — routine on a busy
// calendar). A controlled input is immune to that reset. `values` is seeded
// from `state.values` (the raw strings the action echoes back, see
// ./form-values) whenever a fresh action result arrives, so a rejected
// submit — including its exact number of line rows and its recurrence
// settings — comes back exactly as typed. This mirrors the pattern
// app/profile/profile-manager.tsx settled on for the same defect class.

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

/** Seed the form's local values: the last echoed submission if there is one,
 *  otherwise the empty defaults with the `?date=` deep link applied. */
function initialValues(
  state: CreateReservationState,
  defaultDate?: string,
): SubmittedValues {
  if (state.values) return state.values;
  return { ...EMPTY_SUBMITTED_VALUES, date: defaultDate ?? EMPTY_SUBMITTED_VALUES.date };
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

  const [values, setValues] = useState<SubmittedValues>(() =>
    initialValues(state, defaultDate),
  );
  // Stable row keys so React can add/remove rows without remounting the rest;
  // kept 1:1 by array position with values.lines.
  const [rowIds, setRowIds] = useState<number[]>(() =>
    values.lines.map(() => newRowId()),
  );

  // Re-seed local state whenever the action returns a fresh echo (P11.10). A
  // rejected submit must come back with everything the user typed, including
  // the right number of line rows — not the one empty row we start with.
  // `state` changes identity on every useActionState dispatch, so this fires
  // exactly once per submission.
  useEffect(() => {
    if (!state.values) return;
    setValues(state.values);
    setRowIds(state.values.lines.map(() => newRowId()));
  }, [state]);

  const addRow = () => {
    setRowIds((ids) => [...ids, newRowId()]);
    setValues((v) => ({ ...v, lines: [...v.lines, { itemSlug: "", quantity: "1" }] }));
  };

  const removeRow = (id: number) => {
    if (rowIds.length <= 1) return;
    const idx = rowIds.indexOf(id);
    if (idx === -1) return;
    setRowIds((ids) => ids.filter((r) => r !== id));
    setValues((v) => ({ ...v, lines: v.lines.filter((_, i) => i !== idx) }));
  };

  const updateLine = (
    index: number,
    patch: Partial<SubmittedValues["lines"][number]>,
  ) =>
    setValues((v) => ({
      ...v,
      lines: v.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    }));

  const toggleWeekday = (day: number) => {
    const key = String(day);
    setValues((v) => {
      const has = v.recurrence.byWeekday.includes(key);
      return {
        ...v,
        recurrence: {
          ...v.recurrence,
          byWeekday: has
            ? v.recurrence.byWeekday.filter((d) => d !== key)
            : [...v.recurrence.byWeekday, key],
        },
      };
    });
  };

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
          <legend>When</legend>

          <div className={styles.whenGrid}>
            <label className={styles.field}>
              <span>Date</span>
              <input
                type="date"
                name="date"
                value={values.date}
                onChange={(e) => setValues((v) => ({ ...v, date: e.target.value }))}
                required
              />
              {fieldError("date") ? (
                <p className={styles.fieldError}>{fieldError("date")}</p>
              ) : null}
            </label>

            <label className={styles.field}>
              <span>Start</span>
              <input
                type="time"
                name="startMinute"
                value={values.startMinute}
                onChange={(e) =>
                  setValues((v) => ({ ...v, startMinute: e.target.value }))
                }
                required
              />
              {fieldError("startMinute") ? (
                <p className={styles.fieldError}>{fieldError("startMinute")}</p>
              ) : null}
            </label>

            <label className={styles.field}>
              <span>End</span>
              <input
                type="time"
                name="endMinute"
                value={values.endMinute}
                onChange={(e) =>
                  setValues((v) => ({ ...v, endMinute: e.target.value }))
                }
                required
              />
              {fieldError("endMinute") ? (
                <p className={styles.fieldError}>{fieldError("endMinute")}</p>
              ) : null}
            </label>
          </div>

          <label className={styles.checkRow}>
            <input
              type="checkbox"
              name="recurring"
              checked={values.recurring}
              onChange={(e) =>
                setValues((v) => ({ ...v, recurring: e.target.checked }))
              }
            />
            <span>Repeat this reservation</span>
          </label>

          {values.recurring ? (
            <div className={styles.recurrenceControls}>
              <label className={styles.field}>
                <span>Frequency</span>
                <select
                  name="recurrence-freq"
                  value={values.recurrence.freq}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      recurrence: { ...v.recurrence, freq: e.target.value },
                    }))
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
                  value={values.recurrence.interval}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      recurrence: { ...v.recurrence, interval: e.target.value },
                    }))
                  }
                  className={styles.qtyInput}
                />
              </label>

              {values.recurrence.freq === "weekly" ? (
                <fieldset className={styles.weekdays}>
                  <legend>On weekdays</legend>
                  {WEEKDAYS.map((wd) => (
                    <label key={wd.value} className={styles.weekdayItem}>
                      <input
                        type="checkbox"
                        name="recurrence-byWeekday"
                        value={wd.value}
                        checked={values.recurrence.byWeekday.includes(String(wd.value))}
                        onChange={() => toggleWeekday(wd.value)}
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
                    checked={values.recurrence.endMode === "count"}
                    onChange={() =>
                      setValues((v) => ({
                        ...v,
                        recurrence: { ...v.recurrence, endMode: "count" },
                      }))
                    }
                  />
                  <span>End after</span>
                  <input
                    type="number"
                    name="recurrence-count"
                    min={1}
                    step={1}
                    value={values.recurrence.count}
                    onChange={(e) =>
                      setValues((v) => ({
                        ...v,
                        recurrence: { ...v.recurrence, count: e.target.value },
                      }))
                    }
                    disabled={values.recurrence.endMode !== "count"}
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
                    checked={values.recurrence.endMode === "until"}
                    onChange={() =>
                      setValues((v) => ({
                        ...v,
                        recurrence: { ...v.recurrence, endMode: "until" },
                      }))
                    }
                  />
                  <span>End on</span>
                  <input
                    type="date"
                    name="recurrence-untilDate"
                    value={values.recurrence.untilDate}
                    onChange={(e) =>
                      setValues((v) => ({
                        ...v,
                        recurrence: { ...v.recurrence, untilDate: e.target.value },
                      }))
                    }
                    disabled={values.recurrence.endMode !== "until"}
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
          <legend>Line items</legend>

          {rowIds.map((id, index) => (
            <div key={id} className={styles.lineRow}>
              <label className={styles.field}>
                <span>Product</span>
                <select
                  name={`line-${index}-itemSlug`}
                  value={values.lines[index]?.itemSlug ?? ""}
                  onChange={(e) => updateLine(index, { itemSlug: e.target.value })}
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
                  value={values.lines[index]?.quantity ?? "1"}
                  onChange={(e) => updateLine(index, { quantity: e.target.value })}
                  required
                  className={styles.qtyInput}
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
          <legend>Contact &amp; notes</legend>
          <div className={styles.contactGrid}>
            <label className={styles.field}>
              <span>Title</span>
              <input
                type="text"
                name="title"
                placeholder="e.g. Sunday service"
                value={values.title}
                onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
              />
            </label>
            <label className={styles.field}>
              <span>Contact name</span>
              <input
                type="text"
                name="contactName"
                value={values.contactName}
                onChange={(e) =>
                  setValues((v) => ({ ...v, contactName: e.target.value }))
                }
              />
            </label>
            <label className={styles.field}>
              <span>Contact email</span>
              <input
                type="email"
                name="contactEmail"
                value={values.contactEmail}
                onChange={(e) =>
                  setValues((v) => ({ ...v, contactEmail: e.target.value }))
                }
              />
            </label>
            <label className={styles.field}>
              <span>Contact phone</span>
              <input
                type="tel"
                name="contactPhone"
                value={values.contactPhone}
                onChange={(e) =>
                  setValues((v) => ({ ...v, contactPhone: e.target.value }))
                }
              />
            </label>
          </div>
          <label className={`${styles.field} ${styles.notesField}`}>
            <span>Notes</span>
            <textarea
              name="notes"
              rows={3}
              value={values.notes}
              onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))}
            />
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
