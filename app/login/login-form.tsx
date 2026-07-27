"use client";

import { useState } from "react";

import {
  PROVIDERS,
  signInWithProvider,
  signInWithEmailPassword,
  type ProviderId,
} from "@/lib/auth/firebase-client";
import type { UserRole } from "@/lib/auth/types";

// Client sign-in UI (execution-plan P4.1).
//   • Dev-bypass mode: a role picker that mints a stub session (no Firebase).
//   • Real mode: Email/Password form + provider buttons (Google today) that get
//     a Firebase ID token and exchange it for a session cookie.
// Both flows POST to /api/auth/session and then navigate into the app.

function nextTarget(): string {
  if (typeof window === "undefined") return "/";
  const next = new URLSearchParams(window.location.search).get("next");
  // Only allow same-site relative paths as a redirect target.
  return next && next.startsWith("/") ? next : "/";
}

async function postSession(body: Record<string, unknown>): Promise<void> {
  const res = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Sign-in failed");
  }
}

export function LoginForm({ devBypass }: { devBypass: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      window.location.assign(nextTarget());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setBusy(false);
    }
  }

  function signInDev(role: UserRole) {
    return run(() => postSession({ role }));
  }

  function signInProvider(provider: ProviderId) {
    return run(async () => {
      const idToken = await signInWithProvider(provider);
      await postSession({ idToken });
    });
  }

  function signInEmail() {
    return run(async () => {
      const idToken = await signInWithEmailPassword(email, password);
      await postSession({ idToken });
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {devBypass ? (
        <fieldset
          style={{ border: "1px solid #ccc", borderRadius: 8, padding: "1rem" }}
        >
          <legend>Dev sign-in (local only)</legend>
          <p style={{ marginTop: 0 }}>
            Pick a role to enter the app without a Firebase account.
          </p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              disabled={busy}
              onClick={() => signInDev("scheduler")}
            >
              Continue as Scheduler
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => signInDev("admin")}
            >
              Continue as Admin
            </button>
          </div>
        </fieldset>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void signInEmail();
            }}
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
          >
            <label
              style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}
            >
              Email
              <input
                type="email"
                name="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
              />
            </label>
            <label
              style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}
            >
              Password
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </label>
            <button type="submit" disabled={busy}>
              Sign in
            </button>
          </form>

          {PROVIDERS.length > 0 ? (
            <>
              <div
                aria-hidden
                style={{ textAlign: "center", color: "#888", fontSize: "0.85rem" }}
              >
                or
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
              >
                {PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={busy}
                    onClick={() => signInProvider(p.id)}
                  >
                    Continue with {p.label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      )}

      {error ? (
        <p role="alert" style={{ color: "#b00020" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
