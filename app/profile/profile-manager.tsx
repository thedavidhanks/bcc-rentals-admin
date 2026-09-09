"use client";

import { useActionState, useState } from "react";

import { updateProfileAction } from "./actions";
import { initialProfileActionState } from "./state";
import styles from "./page.module.css";

// Self-service profile client UI (execution-plan P11.3, spec §3/§7). The
// server component (page.tsx) enforces requireScheduler() before rendering
// this, and the server action re-checks requireScheduler() itself, so this
// component never carries authorization weight — it only collects input and
// surfaces the result state from the server action.
//
// The `name` input is a CONTROLLED input (local `name` state, not
// defaultValue). This is deliberate: React resets uncontrolled form fields
// after a Server Action submission completes, which would wipe whatever the
// user typed on a rejected save (the P11.10 defect class, fixed here at
// birth). A controlled input is immune to that reset — its displayed value is
// always whatever the user last typed, echoed straight back on failure.

export interface ProfileView {
  /** False when no app_users row exists for this session (dev-bypass / no
   * auto-provisioning, spec §3) — editing is disabled in that case. */
  hasRow: boolean;
  name: string | null;
  email: string | null;
  /** Friendly label for the read-only role field ("Scheduler" / "Admin"). */
  roleLabel: string;
  /** Pre-formatted display string (America/New_York), or null if never. */
  lastLogin: string | null;
}

export function ProfileManager({
  profile,
  loadError,
}: {
  profile: ProfileView;
  loadError?: string | null;
}) {
  const [state, formAction, pending] = useActionState(updateProfileAction, {
    ...initialProfileActionState,
    name: profile.name ?? "",
  });
  const [name, setName] = useState(state.name ?? profile.name ?? "");

  const disabled = !profile.hasRow || pending;

  return (
    <main className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.title}>My profile</h1>
      </div>

      {loadError ? <p className={styles.error}>{loadError}</p> : null}

      {!profile.hasRow ? (
        <p className={styles.notice} role="status">
          We couldn&apos;t find an account record for your sign-in, so editing
          is disabled here. Contact an admin if this persists.
        </p>
      ) : null}

      {state.status === "error" && state.message ? (
        <p className={styles.error} role="alert">
          {state.message}
        </p>
      ) : null}
      {state.status === "success" && state.message ? (
        <p className={styles.success} role="status">
          {state.message}
        </p>
      ) : null}

      <form action={formAction} className={styles.form}>
        <label className={styles.field}>
          <span>Name</span>
          <input
            type="text"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={disabled}
            autoComplete="off"
            maxLength={200}
          />
          {state.fieldErrors?.name ? (
            <p className={styles.fieldError}>{state.fieldErrors.name}</p>
          ) : null}
        </label>

        <label className={styles.field}>
          <span>Email</span>
          <input
            type="text"
            value={profile.email ?? ""}
            disabled
            readOnly
            className={styles.readOnlyInput}
          />
        </label>

        <label className={styles.field}>
          <span>Permissions</span>
          <input
            type="text"
            value={profile.roleLabel}
            disabled
            readOnly
            className={styles.readOnlyInput}
          />
          <p className={styles.hint}>Contact an admin to change this.</p>
        </label>

        <label className={styles.field}>
          <span>Last login</span>
          <input
            type="text"
            value={profile.lastLogin ?? "Never"}
            disabled
            readOnly
            className={styles.readOnlyInput}
          />
        </label>

        <button type="submit" className={styles.primaryBtn} disabled={disabled}>
          {pending ? "Saving…" : "Save"}
        </button>
      </form>
    </main>
  );
}
