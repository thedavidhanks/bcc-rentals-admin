"use client";

import Link from "next/link";
import { useActionState } from "react";

import { setProductActiveAction } from "./actions";
import { initialProductsActionState } from "./state";
import styles from "./page.module.css";

// Products list client UI (execution-plan P6.4, spec §6/§7). Admin-only — the
// page server component (page.tsx) enforces requireAdmin() before rendering
// this, and the activate/deactivate action re-checks requireAdmin() on the
// server, so this component never carries authorization weight. Mirrors
// app/users/users-manager.tsx.

export interface ProductRowView {
  id: string;
  slug: string;
  name: string;
  type: "unique" | "fungible";
  totalStock: number;
  active: boolean;
  pricingUnit: "hour" | "day" | "event";
  sortOrder: number;
}

export function ProductsList({
  products,
  loadError,
}: {
  products: ProductRowView[];
  loadError?: string | null;
}) {
  const [activeState, activeAction] = useActionState(
    setProductActiveAction,
    initialProductsActionState,
  );

  const active = products.filter((p) => p.active);
  const inactive = products.filter((p) => !p.active);

  return (
    <main className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.title}>Products</h1>
        <Link className={styles.primaryBtn} href="/products/new">
          + Add product
        </Link>
        <Link className={styles.inlineBtn} href="/calendar">
          ← Calendar
        </Link>
      </div>

      {loadError ? <p className={styles.error}>{loadError}</p> : null}

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

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Active ({active.length})</h2>
        {active.length === 0 ? (
          <p className={styles.empty}>No active products.</p>
        ) : (
          <ProductTable products={active} activeAction={activeAction} />
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Inactive ({inactive.length})</h2>
        {inactive.length === 0 ? (
          <p className={styles.empty}>No inactive products.</p>
        ) : (
          <ProductTable products={inactive} activeAction={activeAction} />
        )}
      </section>
    </main>
  );
}

function ProductTable({
  products,
  activeAction,
}: {
  products: ProductRowView[];
  activeAction: (formData: FormData) => void;
}) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Name</th>
          <th>Slug</th>
          <th>Type</th>
          <th>Stock</th>
          <th>Pricing unit</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {products.map((p) => (
          <tr key={p.id} className={p.active ? undefined : styles.inactiveRow}>
            <td>
              <Link href={`/products/${p.id}`}>{p.name}</Link>
            </td>
            <td>{p.slug}</td>
            <td>{p.type}</td>
            <td>{p.totalStock}</td>
            <td>{p.pricingUnit}</td>
            <td>
              {p.active ? (
                <span className={`${styles.badge} ${styles.badgeActive}`}>active</span>
              ) : (
                <span className={`${styles.badge} ${styles.badgeInactive}`}>inactive</span>
              )}
            </td>
            <td>
              <div className={styles.rowActions}>
                <Link className={styles.inlineBtn} href={`/products/${p.id}`}>
                  Edit
                </Link>
                <form action={activeAction} className={styles.rowActions}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="active" value={p.active ? "false" : "true"} />
                  <button
                    type="submit"
                    className={`${styles.inlineBtn} ${p.active ? styles.dangerBtn : ""}`}
                  >
                    {p.active ? "Deactivate" : "Reactivate"}
                  </button>
                </form>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
