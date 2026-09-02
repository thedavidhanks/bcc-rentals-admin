"use client";

import Link from "next/link";
import { Fragment, useActionState, useState } from "react";

import {
  assignItemAction,
  createCategoryAction,
  deleteCategoryAction,
  setItemCategoriesAction,
  unassignItemAction,
  updateCategoryAction,
} from "./actions";
import { initialCategoriesActionState } from "./state";
import { slugify } from "./validation";
import styles from "./page.module.css";

// Categories admin client UI (execution-plan P6.5, spec §6/§7). Admin-only — the
// page server component (page.tsx) enforces requireAdmin() before rendering
// this, and EVERY action re-checks requireAdmin() on the server, so this
// component never carries authorization weight. It only collects input and
// surfaces the result state from the server actions (mirrors app/users, P6.6).

export interface CategoryView {
  id: string;
  slug: string;
  name: string;
  sortOrder: number;
  assignedCount: number;
}

export interface ItemOptionView {
  id: string;
  name: string;
  active: boolean;
  /** Category ids this item currently belongs to. */
  categoryIds: string[];
}

export function CategoriesManager({
  categories,
  items,
  loadError,
}: {
  categories: CategoryView[];
  items: ItemOptionView[];
  loadError?: string | null;
}) {
  const [createState, createAction, createPending] = useActionState(
    createCategoryAction,
    initialCategoriesActionState,
  );
  const [editState, editAction] = useActionState(
    updateCategoryAction,
    initialCategoriesActionState,
  );
  const [deleteState, deleteAction] = useActionState(
    deleteCategoryAction,
    initialCategoriesActionState,
  );
  const [assignState, assignAction] = useActionState(
    assignItemAction,
    initialCategoriesActionState,
  );
  const [unassignState, unassignAction] = useActionState(
    unassignItemAction,
    initialCategoriesActionState,
  );
  const [bulkState, bulkAction] = useActionState(
    setItemCategoriesAction,
    initialCategoriesActionState,
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [bulkEditingItemId, setBulkEditingItemId] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugValue, setSlugValue] = useState("");

  // The delete confirm step is keyed by category id so a confirm banner only
  // ever applies to the row the admin actually clicked delete on.
  const confirmDeleteId =
    deleteState.status === "confirm" ? deleteState.confirmCategoryId ?? null : null;

  // Surface the most recent row-action result (edit/delete/assign/unassign/bulk
  // share the same feedback strip, like app/users' shared rowResult).
  const rowResult = [editState, deleteState, assignState, unassignState, bulkState].find(
    (s) => s.status !== "idle",
  );

  return (
    <main className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.title}>Categories</h1>
        <Link className={styles.inlineBtn} href="/calendar">
          ← Calendar
        </Link>
      </div>

      {loadError ? <p className={styles.error}>{loadError}</p> : null}

      {/* Create form */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Add a category</h2>

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

        <form
          action={createAction}
          className={styles.inviteForm}
          onSubmit={() => {
            setSlugTouched(false);
            setSlugValue("");
          }}
        >
          <label className={styles.field}>
            <span>Name</span>
            <input
              type="text"
              name="name"
              required
              autoComplete="off"
              onChange={(e) => {
                if (!slugTouched) setSlugValue(slugify(e.target.value));
              }}
            />
            {createState.fieldErrors?.name ? (
              <p className={styles.fieldError}>{createState.fieldErrors.name}</p>
            ) : null}
          </label>
          <label className={styles.field}>
            <span>Slug</span>
            <input
              type="text"
              name="slug"
              required
              autoComplete="off"
              value={slugValue}
              onChange={(e) => {
                setSlugTouched(true);
                setSlugValue(e.target.value);
              }}
              placeholder="event-add-on"
            />
            {createState.fieldErrors?.slug ? (
              <p className={styles.fieldError}>{createState.fieldErrors.slug}</p>
            ) : null}
          </label>
          <label className={styles.field}>
            <span>Sort order</span>
            <input type="number" name="sort_order" defaultValue={0} step={1} />
            {createState.fieldErrors?.sort_order ? (
              <p className={styles.fieldError}>{createState.fieldErrors.sort_order}</p>
            ) : null}
          </label>
          <button type="submit" className={styles.primaryBtn} disabled={createPending}>
            {createPending ? "Adding…" : "Add category"}
          </button>
        </form>
      </section>

      {/* Shared row-action feedback */}
      {rowResult && rowResult.status === "error" && rowResult.message ? (
        <p className={styles.error} role="alert">
          {rowResult.message}
        </p>
      ) : null}
      {rowResult && rowResult.status === "success" && rowResult.message ? (
        <p className={styles.success} role="status">
          {rowResult.message}
        </p>
      ) : null}

      {/* Category list */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Categories ({categories.length})</h2>
        {categories.length === 0 ? (
          <p className={styles.empty}>No categories yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>Sort order</th>
                <th>Products</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <Fragment key={c.id}>
                  <tr>
                    <td>{c.name}</td>
                    <td>{c.slug}</td>
                    <td>{c.sortOrder}</td>
                    <td>{c.assignedCount}</td>
                    <td>
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          className={styles.inlineBtn}
                          onClick={() => setEditingId(editingId === c.id ? null : c.id)}
                        >
                          {editingId === c.id ? "Cancel" : "Edit"}
                        </button>
                        {confirmDeleteId === c.id ? (
                          <form action={deleteAction} className={styles.rowActions}>
                            <input type="hidden" name="id" value={c.id} />
                            <input type="hidden" name="confirmed" value="true" />
                            <button
                              type="submit"
                              className={`${styles.inlineBtn} ${styles.dangerBtn}`}
                            >
                              Confirm delete
                            </button>
                          </form>
                        ) : (
                          <form action={deleteAction} className={styles.rowActions}>
                            <input type="hidden" name="id" value={c.id} />
                            <button
                              type="submit"
                              className={`${styles.inlineBtn} ${styles.dangerBtn}`}
                            >
                              Delete
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                  {confirmDeleteId === c.id && deleteState.message ? (
                    <tr key={`${c.id}-confirm`}>
                      <td colSpan={5}>
                        <p className={styles.confirmBanner} role="alert">
                          {deleteState.message}
                        </p>
                      </td>
                    </tr>
                  ) : null}
                  {editingId === c.id ? (
                    <tr key={`${c.id}-edit`}>
                      <td colSpan={5}>
                        <form action={editAction} className={styles.inviteForm}>
                          <input type="hidden" name="id" value={c.id} />
                          <label className={styles.field}>
                            <span>Name</span>
                            <input type="text" name="name" defaultValue={c.name} required />
                          </label>
                          <label className={styles.field}>
                            <span>Slug</span>
                            <input type="text" name="slug" defaultValue={c.slug} required />
                          </label>
                          <label className={styles.field}>
                            <span>Sort order</span>
                            <input
                              type="number"
                              name="sort_order"
                              defaultValue={c.sortOrder}
                              step={1}
                            />
                          </label>
                          {editState.fieldErrors ? (
                            <p className={styles.fieldError}>
                              {Object.values(editState.fieldErrors).join(" ")}
                            </p>
                          ) : null}
                          <button type="submit" className={styles.primaryBtn}>
                            Save
                          </button>
                        </form>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Product ↔ category assignment */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Assign products to categories</h2>
        {items.length === 0 || categories.length === 0 ? (
          <p className={styles.empty}>
            {categories.length === 0
              ? "Add a category before assigning products."
              : "No products to assign yet."}
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Product</th>
                {categories.map((c) => (
                  <th key={c.id}>{c.name}</th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <Fragment key={item.id}>
                  <tr className={item.active ? undefined : styles.inactiveRow}>
                    <td>
                      {item.name}
                      {!item.active ? (
                        <span className={`${styles.badge} ${styles.badgeInactive}`}> inactive</span>
                      ) : null}
                    </td>
                    {categories.map((c) => {
                      const assigned = item.categoryIds.includes(c.id);
                      return (
                        <td key={c.id}>
                          <form
                            action={assigned ? unassignAction : assignAction}
                            className={styles.rowActions}
                          >
                            <input type="hidden" name="itemId" value={item.id} />
                            <input type="hidden" name="categoryId" value={c.id} />
                            <button
                              type="submit"
                              className={styles.inlineBtn}
                              aria-pressed={assigned}
                            >
                              {assigned ? "✓" : "—"}
                            </button>
                          </form>
                        </td>
                      );
                    })}
                    <td>
                      <button
                        type="button"
                        className={styles.inlineBtn}
                        onClick={() =>
                          setBulkEditingItemId(bulkEditingItemId === item.id ? null : item.id)
                        }
                      >
                        {bulkEditingItemId === item.id ? "Cancel" : "Set all"}
                      </button>
                    </td>
                  </tr>
                  {bulkEditingItemId === item.id ? (
                    <tr key={`${item.id}-bulk`}>
                      <td colSpan={categories.length + 2}>
                        <form action={bulkAction} className={styles.rowActions}>
                          <input type="hidden" name="itemId" value={item.id} />
                          {categories.map((c) => (
                            <label key={c.id} className={styles.checkboxLabel}>
                              <input
                                type="checkbox"
                                name="categoryIds"
                                value={c.id}
                                defaultChecked={item.categoryIds.includes(c.id)}
                              />
                              {c.name}
                            </label>
                          ))}
                          <button type="submit" className={styles.primaryBtn}>
                            Save all
                          </button>
                        </form>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
