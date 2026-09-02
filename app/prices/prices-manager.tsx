"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, type ChangeEvent } from "react";

import { createPriceAction, deletePriceAction, updatePriceAction } from "./actions";
import {
  formatCentsToDollars,
  formatDaysOfWeek,
  formatHourWindow,
} from "./pricing";
import { initialPriceActionState, type PriceActionState } from "./state";
import styles from "./page.module.css";

// Update Prices client UI (execution-plan P6.3, spec §6/§7). Scheduler+admin —
// the page server component (page.tsx) enforces requireScheduler() before
// rendering this, and EVERY action re-checks requireScheduler() on the server,
// so this component never carries authorization weight. It only collects
// input and surfaces the result state (including the base-row warning /
// confirm flow) from the server actions.

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface ItemOption {
  id: string;
  slug: string;
  name: string;
  active: boolean;
}

export interface PriceRowView {
  id: string;
  priceCents: number;
  daysOfWeek: number[] | null;
  startMinute: number | null;
  endMinute: number | null;
  priority: number;
  label: string | null;
  isBase: boolean;
}

export function PricesManager({
  items,
  selectedItemId,
  prices,
  loadError,
}: {
  items: ItemOption[];
  selectedItemId: string | null;
  prices: PriceRowView[];
  loadError?: string | null;
}) {
  const router = useRouter();

  const [createState, createAction, createPending] = useActionState(
    createPriceAction,
    initialPriceActionState,
  );
  const [updateState, updateAction] = useActionState(updatePriceAction, initialPriceActionState);
  const [deleteState, deleteAction] = useActionState(deletePriceAction, initialPriceActionState);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmUpdateId, setConfirmUpdateId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Sync the "needs confirmation" row from the action results: a "warning"
  // result means this row's next submit should carry confirmed=true; a
  // "success" result clears any pending confirmation and closes the editor.
  useEffect(() => {
    if (updateState.status === "warning") {
      setConfirmUpdateId(updateState.priceId ?? null);
    } else if (updateState.status === "success") {
      setConfirmUpdateId(null);
      setEditingId(null);
    }
  }, [updateState]);

  useEffect(() => {
    if (deleteState.status === "warning") {
      setConfirmDeleteId(deleteState.priceId ?? null);
    } else if (deleteState.status === "success") {
      setConfirmDeleteId(null);
    }
  }, [deleteState]);

  const selectedItem = items.find((i) => i.id === selectedItemId) ?? null;
  const baseRow = prices.find((p) => p.isBase) ?? null;
  const overrides = prices
    .filter((p) => !p.isBase)
    .sort((a, b) => b.priority - a.priority);

  function onItemChange(e: ChangeEvent<HTMLSelectElement>) {
    router.push(`/prices?item=${encodeURIComponent(e.target.value)}`);
  }

  return (
    <main className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.title}>Update Prices</h1>
        <Link className={styles.inlineBtn} href="/calendar">
          ← Calendar
        </Link>
      </div>

      {loadError ? <p className={styles.error}>{loadError}</p> : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Item</h2>
        {items.length === 0 ? (
          <p className={styles.empty}>No items found.</p>
        ) : (
          <select
            className={styles.itemSelect}
            value={selectedItemId ?? ""}
            onChange={onItemChange}
          >
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
                {i.active ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        )}
      </section>

      {selectedItem ? (
        <>
          {!baseRow ? (
            <p className={styles.warning} role="alert">
              This item has no all-days/all-hours base rate — the storefront cannot quote
              it without a fallback rate. Add one below.
            </p>
          ) : null}

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Base rate</h2>
            {baseRow ? (
              <PriceRow
                row={baseRow}
                itemId={selectedItem.id}
                editing={editingId === baseRow.id}
                onToggleEdit={() =>
                  setEditingId(editingId === baseRow.id ? null : baseRow.id)
                }
                updateAction={updateAction}
                deleteAction={deleteAction}
                updateState={updateState}
                deleteState={deleteState}
                confirmUpdate={confirmUpdateId === baseRow.id}
                confirmDelete={confirmDeleteId === baseRow.id}
              />
            ) : (
              <p className={styles.empty}>No base rate set.</p>
            )}
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Overrides ({overrides.length})</h2>
            {overrides.length === 0 ? (
              <p className={styles.empty}>No day/time overrides.</p>
            ) : (
              <ul className={styles.rowList}>
                {overrides.map((row) => (
                  <li key={row.id}>
                    <PriceRow
                      row={row}
                      itemId={selectedItem.id}
                      editing={editingId === row.id}
                      onToggleEdit={() => setEditingId(editingId === row.id ? null : row.id)}
                      updateAction={updateAction}
                      deleteAction={deleteAction}
                      updateState={updateState}
                      deleteState={deleteState}
                      confirmUpdate={confirmUpdateId === row.id}
                      confirmDelete={confirmDeleteId === row.id}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Add a price row</h2>
            {createState.status === "error" && createState.message ? (
              <p className={styles.error} role="alert">
                {createState.message}
              </p>
            ) : null}
            {createState.status === "success" && createState.message ? (
              <p className={styles.success} role="status">
                {createState.message}
              </p>
            ) : null}
            <form action={createAction} className={styles.form}>
              <input type="hidden" name="itemId" value={selectedItem.id} />
              <PriceFields fieldErrors={createState.fieldErrors} />
              <button type="submit" className={styles.primaryBtn} disabled={createPending}>
                {createPending ? "Adding…" : "Add price row"}
              </button>
            </form>
          </section>
        </>
      ) : null}
    </main>
  );
}

// ---------------------------------------------------------------------------
// One price row: summary + inline edit form + delete control (with the
// base-row two-step confirm).
// ---------------------------------------------------------------------------

function PriceRow({
  row,
  itemId,
  editing,
  onToggleEdit,
  updateAction,
  deleteAction,
  updateState,
  deleteState,
  confirmUpdate,
  confirmDelete,
}: {
  row: PriceRowView;
  itemId: string;
  editing: boolean;
  onToggleEdit: () => void;
  updateAction: (formData: FormData) => void;
  deleteAction: (formData: FormData) => void;
  updateState: PriceActionState;
  deleteState: PriceActionState;
  confirmUpdate: boolean;
  confirmDelete: boolean;
}) {
  const updateResultIsMine = updateState.priceId === row.id && updateState.status !== "idle";
  const deleteResultIsMine = deleteState.priceId === row.id && deleteState.status !== "idle";

  return (
    <div className={styles.priceRow}>
      <div className={styles.priceSummary}>
        <span className={styles.priceAmount}>${formatCentsToDollars(row.priceCents)}</span>
        {row.isBase ? <span className={`${styles.badge} ${styles.badgeBase}`}>base</span> : null}
        <span className={styles.priceMeta}>
          {formatDaysOfWeek(row.daysOfWeek)} · {formatHourWindow(row.startMinute, row.endMinute)} ·
          priority {row.priority}
        </span>
        {row.label ? <span className={styles.priceLabel}>{row.label}</span> : null}
      </div>

      {updateResultIsMine && updateState.status === "error" && updateState.message ? (
        <p className={styles.error} role="alert">
          {updateState.message}
        </p>
      ) : null}
      {updateResultIsMine && updateState.status === "warning" && updateState.message ? (
        <p className={styles.warning} role="alert">
          {updateState.message}
        </p>
      ) : null}
      {updateResultIsMine && updateState.status === "success" && updateState.message ? (
        <p className={styles.success} role="status">
          {updateState.message}
        </p>
      ) : null}
      {deleteResultIsMine && deleteState.status === "error" && deleteState.message ? (
        <p className={styles.error} role="alert">
          {deleteState.message}
        </p>
      ) : null}
      {deleteResultIsMine && deleteState.status === "warning" && deleteState.message ? (
        <p className={styles.warning} role="alert">
          {deleteState.message}
        </p>
      ) : null}

      <div className={styles.rowActions}>
        <button type="button" className={styles.inlineBtn} onClick={onToggleEdit}>
          {editing ? "Cancel" : "Edit"}
        </button>
        {!editing ? (
          <form action={deleteAction} className={styles.rowActions}>
            <input type="hidden" name="id" value={row.id} />
            <input type="hidden" name="itemId" value={itemId} />
            <input type="hidden" name="confirmed" value={confirmDelete ? "true" : "false"} />
            <button type="submit" className={`${styles.inlineBtn} ${styles.dangerBtn}`}>
              {confirmDelete ? "Confirm delete" : "Delete"}
            </button>
          </form>
        ) : null}
      </div>

      {editing ? (
        <form action={updateAction} className={styles.form}>
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="itemId" value={itemId} />
          <input type="hidden" name="confirmed" value={confirmUpdate ? "true" : "false"} />
          <PriceFields
            defaults={{
              price: formatCentsToDollars(row.priceCents),
              priority: row.priority,
              label: row.label,
              daysOfWeek: row.daysOfWeek,
              startMinute: row.startMinute,
              endMinute: row.endMinute,
            }}
            fieldErrors={updateResultIsMine ? updateState.fieldErrors : undefined}
          />
          <button type="submit" className={styles.primaryBtn}>
            {confirmUpdate ? "Confirm save" : "Save"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared price/priority/label/day/hour fields for the create + edit forms.
// ---------------------------------------------------------------------------

function PriceFields({
  defaults,
  fieldErrors,
}: {
  defaults?: {
    price?: string;
    priority?: number;
    label?: string | null;
    daysOfWeek?: number[] | null;
    startMinute?: number | null;
    endMinute?: number | null;
  };
  fieldErrors?: Record<string, string>;
}) {
  const scopeDefault = defaults?.daysOfWeek == null ? "all" : "custom";
  const allHoursDefault = defaults?.startMinute == null && defaults?.endMinute == null;
  const selectedDays = new Set(defaults?.daysOfWeek ?? []);

  return (
    <div className={styles.fieldsGrid}>
      <label className={styles.field}>
        <span>Price ($)</span>
        <input
          type="text"
          inputMode="decimal"
          name="price"
          defaultValue={defaults?.price ?? ""}
          placeholder="12.34"
          required
        />
        {fieldErrors?.price ? <p className={styles.fieldError}>{fieldErrors.price}</p> : null}
      </label>

      <label className={styles.field}>
        <span>Priority</span>
        <input type="number" name="priority" defaultValue={defaults?.priority ?? 0} />
        {fieldErrors?.priority ? <p className={styles.fieldError}>{fieldErrors.priority}</p> : null}
      </label>

      <label className={styles.field}>
        <span>Label (optional)</span>
        <input type="text" name="label" defaultValue={defaults?.label ?? ""} maxLength={200} />
        {fieldErrors?.label ? <p className={styles.fieldError}>{fieldErrors.label}</p> : null}
      </label>

      <fieldset className={styles.fieldset}>
        <legend>Days</legend>
        <label className={styles.radioLabel}>
          <input type="radio" name="scope" value="all" defaultChecked={scopeDefault === "all"} />
          Every day
        </label>
        <label className={styles.radioLabel}>
          <input
            type="radio"
            name="scope"
            value="custom"
            defaultChecked={scopeDefault === "custom"}
          />
          Specific days
        </label>
        <div className={styles.dayChecks}>
          {DAY_NAMES.map((label, d) => (
            <label key={d} className={styles.checkLabel}>
              <input type="checkbox" name="days" value={d} defaultChecked={selectedDays.has(d)} />
              {label}
            </label>
          ))}
        </div>
        {fieldErrors?.days ? <p className={styles.fieldError}>{fieldErrors.days}</p> : null}
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>Hours (Eastern minutes since midnight)</legend>
        <label className={styles.checkLabel}>
          <input type="checkbox" name="allHours" defaultChecked={allHoursDefault} />
          All hours
        </label>
        <label className={styles.field}>
          <span>Start minute</span>
          <input
            type="number"
            name="startMinute"
            min={0}
            max={1440}
            defaultValue={defaults?.startMinute ?? ""}
          />
        </label>
        <label className={styles.field}>
          <span>End minute</span>
          <input
            type="number"
            name="endMinute"
            min={0}
            max={1440}
            defaultValue={defaults?.endMinute ?? ""}
          />
        </label>
        {fieldErrors?.endMinute ? <p className={styles.fieldError}>{fieldErrors.endMinute}</p> : null}
      </fieldset>
    </div>
  );
}
