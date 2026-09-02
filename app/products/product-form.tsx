"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { createProductAction, setProductActiveAction, updateProductAction } from "./actions";
import { initialProductsActionState } from "./state";
import { slugify } from "./validation";
import styles from "./page.module.css";

// Add/Edit Product client form (execution-plan P6.4, spec §6/§7). Admin-only —
// the page server component enforces requireAdmin() before rendering this,
// and EVERY action re-checks requireAdmin() on the server, so this component
// never carries authorization weight. One shared component handles both the
// Add Product and Edit Product pages (`mode`); mirrors app/users/users-manager.tsx.
//
// Pricing is intentionally out of scope past the create form's base price:
// the Edit Product page links to /prices for full item_prices CRUD (owned by
// the P6.3 agent this wave) rather than editing prices inline.

export interface ProductFormValues {
  id: string;
  slug: string;
  name: string;
  type: "unique" | "fungible";
  totalStock: string;
  active: boolean;
  shortDescription: string;
  longDescription: string;
  highlights: string; // newline-joined, one bullet per line
  image: string;
  pricingUnit: "hour" | "day" | "event";
  minMinutes: string;
  maxMinutes: string;
  bufferMinutes: string;
  leadHours: string;
  horizonDays: string;
  availableHoursEnabled: boolean;
  availableHoursOpen: string;
  availableHoursClose: string;
  availableHoursSlot: string;
  sortOrder: string;
}

export const emptyProductFormValues: ProductFormValues = {
  id: "",
  slug: "",
  name: "",
  type: "fungible",
  totalStock: "1",
  active: true,
  shortDescription: "",
  longDescription: "",
  highlights: "",
  image: "",
  pricingUnit: "day",
  minMinutes: "",
  maxMinutes: "",
  bufferMinutes: "0",
  leadHours: "0",
  horizonDays: "365",
  availableHoursEnabled: false,
  availableHoursOpen: "",
  availableHoursClose: "",
  availableHoursSlot: "",
  sortOrder: "0",
};

export function ProductForm({
  mode,
  initial,
  loadError,
}: {
  mode: "create" | "edit";
  initial?: ProductFormValues;
  loadError?: string | null;
}) {
  const values = initial ?? emptyProductFormValues;

  const [saveState, saveAction, savePending] = useActionState(
    mode === "create" ? createProductAction : updateProductAction,
    initialProductsActionState,
  );
  const [activeState, activeAction] = useActionState(
    setProductActiveAction,
    initialProductsActionState,
  );

  const [name, setName] = useState(values.name);
  const [slug, setSlug] = useState(values.slug);
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const [type, setType] = useState(values.type);
  const [totalStock, setTotalStock] = useState(values.totalStock);
  const [availableHoursEnabled, setAvailableHoursEnabled] = useState(
    values.availableHoursEnabled,
  );

  const fieldErrors = saveState.fieldErrors ?? {};

  if (mode === "edit" && !initial) {
    return (
      <main className={styles.page}>
        <div className={styles.toolbar}>
          <h1 className={styles.title}>Edit Product</h1>
          <Link className={styles.inlineBtn} href="/products">
            ← Products
          </Link>
        </div>
        <p className={styles.error} role="alert">
          {loadError ?? "Could not load the product."}
        </p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.title}>{mode === "create" ? "Add Product" : "Edit Product"}</h1>
        <Link className={styles.inlineBtn} href="/products">
          ← Products
        </Link>
      </div>

      {loadError ? <p className={styles.error}>{loadError}</p> : null}

      {saveState.status === "error" && saveState.message ? (
        <p className={styles.error} role="alert">
          {saveState.message}
        </p>
      ) : null}
      {saveState.status === "success" && saveState.message ? (
        <p className={styles.success} role="status">
          {saveState.message}
        </p>
      ) : null}

      <form action={saveAction} className={styles.form}>
        {mode === "edit" ? <input type="hidden" name="id" value={values.id} /> : null}

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Basics</h2>
          <div className={styles.formRow}>
            <label className={styles.field}>
              <span>Name</span>
              <input
                type="text"
                name="name"
                required
                defaultValue={values.name}
                onChange={(e) => {
                  const next = e.target.value;
                  setName(next);
                  if (!slugTouched) setSlug(slugify(next));
                }}
              />
              {fieldErrors.name ? <p className={styles.fieldError}>{fieldErrors.name}</p> : null}
            </label>

            <label className={styles.field}>
              <span>Slug</span>
              <input
                type="text"
                name="slug"
                required
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
              />
              {fieldErrors.slug ? <p className={styles.fieldError}>{fieldErrors.slug}</p> : null}
              <button
                type="button"
                className={styles.inlineBtn}
                onClick={() => {
                  setSlugTouched(true);
                  setSlug(slugify(name));
                }}
              >
                Suggest from name
              </button>
            </label>

            <label className={styles.field}>
              <span>Type</span>
              <select
                name="type"
                value={type}
                onChange={(e) => setType(e.target.value as "unique" | "fungible")}
              >
                <option value="fungible">fungible (stock N)</option>
                <option value="unique">unique (stock 1)</option>
              </select>
              {fieldErrors.type ? <p className={styles.fieldError}>{fieldErrors.type}</p> : null}
            </label>

            <label className={styles.field}>
              <span>Total stock</span>
              <input
                type="number"
                name="totalStock"
                min={1}
                step={1}
                required
                readOnly={type === "unique"}
                value={type === "unique" ? "1" : totalStock}
                onChange={(e) => setTotalStock(e.target.value)}
              />
              {fieldErrors.totalStock ? (
                <p className={styles.fieldError}>{fieldErrors.totalStock}</p>
              ) : null}
            </label>

            {mode === "create" ? (
              <label className={styles.checkboxField}>
                <input type="checkbox" name="active" defaultChecked={values.active} />
                <span>Active (listed on the storefront)</span>
              </label>
            ) : null}
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Description</h2>
          <div className={styles.formRow}>
            <label className={styles.field} style={{ flexBasis: "100%" }}>
              <span>Short description</span>
              <input type="text" name="shortDescription" defaultValue={values.shortDescription} />
            </label>
            <label className={styles.field} style={{ flexBasis: "100%" }}>
              <span>Long description</span>
              <textarea name="longDescription" defaultValue={values.longDescription} />
            </label>
            <label className={styles.field} style={{ flexBasis: "100%" }}>
              <span>Highlights (one per line)</span>
              <textarea name="highlights" defaultValue={values.highlights} />
            </label>
            <label className={styles.field}>
              <span>Image path</span>
              <input
                type="text"
                name="image"
                placeholder="/images/tent.jpg"
                defaultValue={values.image}
              />
            </label>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Pricing &amp; scheduling rules</h2>
          <div className={styles.formRow}>
            <label className={styles.field}>
              <span>Pricing unit</span>
              <select name="pricingUnit" defaultValue={values.pricingUnit}>
                <option value="hour">hour</option>
                <option value="day">day</option>
                <option value="event">event</option>
              </select>
              {fieldErrors.pricingUnit ? (
                <p className={styles.fieldError}>{fieldErrors.pricingUnit}</p>
              ) : null}
            </label>

            {mode === "create" ? (
              <label className={styles.field}>
                <span>Base price (USD)</span>
                <input type="text" name="basePrice" placeholder="25.00" required />
                <p className={styles.hint}>
                  Written as the item&apos;s first all-days/all-hours price row.
                </p>
                {fieldErrors.basePrice ? (
                  <p className={styles.fieldError}>{fieldErrors.basePrice}</p>
                ) : null}
              </label>
            ) : (
              <div className={styles.field}>
                <span>Pricing</span>
                <Link className={styles.inlineBtn} href="/prices">
                  Manage prices →
                </Link>
              </div>
            )}

            <label className={styles.field}>
              <span>Min minutes</span>
              <input type="number" name="minMinutes" min={1} step={1} defaultValue={values.minMinutes} />
              {fieldErrors.minMinutes ? (
                <p className={styles.fieldError}>{fieldErrors.minMinutes}</p>
              ) : null}
            </label>

            <label className={styles.field}>
              <span>Max minutes</span>
              <input type="number" name="maxMinutes" min={1} step={1} defaultValue={values.maxMinutes} />
              {fieldErrors.maxMinutes ? (
                <p className={styles.fieldError}>{fieldErrors.maxMinutes}</p>
              ) : null}
            </label>

            <label className={styles.field}>
              <span>Buffer minutes</span>
              <input
                type="number"
                name="bufferMinutes"
                min={0}
                step={1}
                defaultValue={values.bufferMinutes}
              />
              {fieldErrors.bufferMinutes ? (
                <p className={styles.fieldError}>{fieldErrors.bufferMinutes}</p>
              ) : null}
            </label>

            <label className={styles.field}>
              <span>Lead hours</span>
              <input type="number" name="leadHours" min={0} step={1} defaultValue={values.leadHours} />
              {fieldErrors.leadHours ? (
                <p className={styles.fieldError}>{fieldErrors.leadHours}</p>
              ) : null}
            </label>

            <label className={styles.field}>
              <span>Horizon days</span>
              <input
                type="number"
                name="horizonDays"
                min={1}
                step={1}
                defaultValue={values.horizonDays}
              />
              {fieldErrors.horizonDays ? (
                <p className={styles.fieldError}>{fieldErrors.horizonDays}</p>
              ) : null}
            </label>

            <label className={styles.field}>
              <span>Sort order</span>
              <input type="number" name="sortOrder" step={1} defaultValue={values.sortOrder} />
              {fieldErrors.sortOrder ? (
                <p className={styles.fieldError}>{fieldErrors.sortOrder}</p>
              ) : null}
            </label>
          </div>

          <div className={styles.formRow}>
            <label className={styles.checkboxField}>
              <input
                type="checkbox"
                name="availableHoursEnabled"
                checked={availableHoursEnabled}
                onChange={(e) => setAvailableHoursEnabled(e.target.checked)}
              />
              <span>Restrict to specific open hours (leave off for day/event items)</span>
            </label>
          </div>

          {availableHoursEnabled ? (
            <div className={styles.formRow}>
              <label className={styles.field}>
                <span>Open hour (0–24)</span>
                <input
                  type="number"
                  name="availableHoursOpen"
                  min={0}
                  max={24}
                  step={1}
                  defaultValue={values.availableHoursOpen}
                />
                {fieldErrors["availableHours.openHour"] ? (
                  <p className={styles.fieldError}>{fieldErrors["availableHours.openHour"]}</p>
                ) : null}
              </label>
              <label className={styles.field}>
                <span>Close hour (0–24)</span>
                <input
                  type="number"
                  name="availableHoursClose"
                  min={0}
                  max={24}
                  step={1}
                  defaultValue={values.availableHoursClose}
                />
                {fieldErrors["availableHours.closeHour"] ? (
                  <p className={styles.fieldError}>{fieldErrors["availableHours.closeHour"]}</p>
                ) : null}
              </label>
              <label className={styles.field}>
                <span>Slot minutes</span>
                <input
                  type="number"
                  name="availableHoursSlot"
                  min={1}
                  step={1}
                  defaultValue={values.availableHoursSlot}
                />
                {fieldErrors["availableHours.slotMinutes"] ? (
                  <p className={styles.fieldError}>{fieldErrors["availableHours.slotMinutes"]}</p>
                ) : null}
              </label>
            </div>
          ) : null}
        </section>

        <div className={styles.formRow}>
          <button type="submit" className={styles.primaryBtn} disabled={savePending}>
            {savePending
              ? "Saving…"
              : mode === "create"
                ? "Create product"
                : "Save changes"}
          </button>
        </div>
      </form>

      {mode === "edit" ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Status</h2>
          {activeState.status === "error" && activeState.message ? (
            <p className={styles.error} role="alert">
              {activeState.message}
            </p>
          ) : null}
          {activeState.status === "success" && activeState.message ? (
            <p className={styles.success} role="status">
              {activeState.message}
            </p>
          ) : null}
          <form action={activeAction} className={styles.rowActions}>
            <input type="hidden" name="id" value={values.id} />
            <input type="hidden" name="active" value={values.active ? "false" : "true"} />
            <button
              type="submit"
              className={`${styles.inlineBtn} ${values.active ? styles.dangerBtn : ""}`}
            >
              {values.active ? "Deactivate" : "Reactivate"}
            </button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
