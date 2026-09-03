"use client";

import { useState } from "react";

/**
 * Clears the session cookie via `DELETE /api/auth/session`, then does a full
 * page navigation to `/login`. The full navigation (not `router.push`) is
 * deliberate: it discards all client caches of the signed-in tree.
 *
 * Shared by the standalone `SignOutButton` below and the top-nav account
 * menu's Logout item (P11.2, `components/nav/AccountMenu.tsx`) so the fetch
 * only lives in one place.
 */
export async function signOut(): Promise<void> {
  try {
    await fetch("/api/auth/session", { method: "DELETE" });
  } finally {
    window.location.assign("/login");
  }
}

// Minimal sign-out control: clears the session cookie via the DELETE endpoint,
// then returns to /login. Superseded in the top nav by the account menu
// (P11.2) but kept as a standalone building block.
export function SignOutButton() {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    await signOut();
  }

  return (
    <button type="button" disabled={busy} onClick={handleClick}>
      Sign out
    </button>
  );
}
