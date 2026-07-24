"use client";

import { useState } from "react";

// Minimal sign-out control: clears the session cookie via the DELETE endpoint,
// then returns to /login. The app shell (P5, Agent B) can restyle/relocate this.
export function SignOutButton() {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <button type="button" disabled={busy} onClick={signOut}>
      Sign out
    </button>
  );
}
