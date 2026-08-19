"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  inviteUserAction,
  revokeInviteAction,
  setActiveAction,
  setRoleAction,
} from "./actions";
import { initialUsersActionState } from "./state";
import styles from "./page.module.css";

// Users admin client UI (execution-plan P6.6, spec §6/§7). Admin-only — the page
// server component (page.tsx) enforces requireAdmin() before rendering this, and
// EVERY action re-checks requireAdmin() on the server, so this component never
// carries authorization weight. It only collects input and surfaces the result
// state (field-level + top-level errors) from the server actions.

export interface UserRowView {
  id: string;
  uid: string | null; // null => pending invite
  email: string | null;
  name: string | null;
  role: "scheduler" | "admin";
  active: boolean;
  lastLogin: string | null; // pre-formatted display string
}

export function UsersManager({
  users,
  loadError,
}: {
  users: UserRowView[];
  loadError?: string | null;
}) {
  const [inviteState, inviteAction, invitePending] = useActionState(
    inviteUserAction,
    initialUsersActionState,
  );
  // One shared action-state for all row mutations (role / activate / revoke).
  const [rowState, roleAction] = useActionState(setRoleAction, initialUsersActionState);
  const [activeState, activeAction] = useActionState(setActiveAction, initialUsersActionState);
  const [revokeState, revokeAction] = useActionState(revokeInviteAction, initialUsersActionState);

  const pending = users.filter((u) => u.uid === null);
  const bound = users.filter((u) => u.uid !== null);

  // Surface the most recent row-action result (role/activate/revoke share space).
  const rowResult = [revokeState, activeState, rowState].find(
    (s) => s.status !== "idle",
  );

  return (
    <main className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.title}>Users</h1>
        <Link className={styles.inlineBtn} href="/calendar">
          ← Calendar
        </Link>
      </div>

      {loadError ? <p className={styles.error}>{loadError}</p> : null}

      {/* Invite form */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Invite a user</h2>

        {inviteState.status === "error" && inviteState.message ? (
          <p className={styles.error} role="alert">
            {inviteState.message}
          </p>
        ) : null}
        {inviteState.status === "success" && inviteState.message ? (
          <p className={styles.success} role="status">
            {inviteState.message}
          </p>
        ) : null}

        <form action={inviteAction} className={styles.inviteForm}>
          <label className={styles.field}>
            <span>Email</span>
            <input type="email" name="email" required autoComplete="off" />
            {inviteState.fieldErrors?.email ? (
              <p className={styles.fieldError}>{inviteState.fieldErrors.email}</p>
            ) : null}
          </label>
          <label className={styles.field}>
            <span>Name (optional)</span>
            <input type="text" name="name" autoComplete="off" />
            {inviteState.fieldErrors?.name ? (
              <p className={styles.fieldError}>{inviteState.fieldErrors.name}</p>
            ) : null}
          </label>
          <label className={styles.field}>
            <span>Role</span>
            <select name="role" defaultValue="scheduler">
              <option value="scheduler">scheduler</option>
              <option value="admin">admin</option>
            </select>
            {inviteState.fieldErrors?.role ? (
              <p className={styles.fieldError}>{inviteState.fieldErrors.role}</p>
            ) : null}
          </label>
          <button type="submit" className={styles.primaryBtn} disabled={invitePending}>
            {invitePending ? "Inviting…" : "Send invite"}
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

      {/* Pending invites */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Pending invites ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className={styles.empty}>No pending invites.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((u) => (
                <tr key={u.id}>
                  <td>{u.name ?? <span className={styles.muted}>—</span>}</td>
                  <td>{u.email}</td>
                  <td>
                    <RoleBadge role={u.role} />
                  </td>
                  <td>
                    <span className={`${styles.badge} ${styles.badgePending}`}>pending</span>
                  </td>
                  <td>
                    <form action={revokeAction} className={styles.rowActions}>
                      <input type="hidden" name="id" value={u.id} />
                      <button type="submit" className={`${styles.inlineBtn} ${styles.dangerBtn}`}>
                        Revoke
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Bound users */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Accounts ({bound.length})</h2>
        {bound.length === 0 ? (
          <p className={styles.empty}>No accounts yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Active</th>
                <th>Last login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {bound.map((u) => (
                <tr key={u.id} className={u.active ? undefined : styles.inactiveRow}>
                  <td>{u.name ?? <span className={styles.muted}>—</span>}</td>
                  <td>{u.email ?? <span className={styles.muted}>—</span>}</td>
                  <td>
                    <RoleBadge role={u.role} />
                  </td>
                  <td>
                    {u.active ? (
                      <span className={`${styles.badge} ${styles.badgeActive}`}>active</span>
                    ) : (
                      <span className={`${styles.badge} ${styles.badgeInactive}`}>inactive</span>
                    )}
                  </td>
                  <td>{u.lastLogin ?? <span className={styles.muted}>never</span>}</td>
                  <td>
                    <div className={styles.rowActions}>
                      <form action={roleAction} className={styles.rowActions}>
                        <input type="hidden" name="id" value={u.id} />
                        <input
                          type="hidden"
                          name="role"
                          value={u.role === "admin" ? "scheduler" : "admin"}
                        />
                        <button type="submit" className={styles.inlineBtn}>
                          {u.role === "admin" ? "Make scheduler" : "Make admin"}
                        </button>
                      </form>
                      <form action={activeAction} className={styles.rowActions}>
                        <input type="hidden" name="id" value={u.id} />
                        <input type="hidden" name="active" value={u.active ? "false" : "true"} />
                        <button
                          type="submit"
                          className={`${styles.inlineBtn} ${u.active ? styles.dangerBtn : ""}`}
                        >
                          {u.active ? "Deactivate" : "Reactivate"}
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

function RoleBadge({ role }: { role: "scheduler" | "admin" }) {
  const cls = role === "admin" ? styles.badgeAdmin : styles.badgeScheduler;
  return <span className={`${styles.badge} ${cls}`}>{role}</span>;
}
