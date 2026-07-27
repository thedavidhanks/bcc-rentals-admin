// Firebase Web SDK sign-in seam (client). Spec §3, execution-plan P4.1.
//
// Client-side counterpart to lib/auth/session.ts. It renders no UI; it exposes
// the sign-in calls the login form uses to obtain a Firebase ID token, which the
// form POSTs to /api/auth/session to be exchanged for a session cookie.
//
// Q2 status (answered 2026-07-26): the Firebase project config is now provided
// (see .env.local / NEXT_PUBLIC_FIREBASE_* — project `bcc-admin-staging`). The
// sign-in methods enabled for launch are **Google** and **Email/Password**.
// GitHub / Facebook / Apple remain in `ProviderId` for forward-compat but are
// NOT enabled in the Firebase console yet — calling one throws a clear error
// until its OAuth app is registered and it's re-added to `PROVIDERS`.
//
// This is the *real* client path. The dev-bypass role picker (see session.ts —
// active when NODE_ENV !== 'production' && AUTH_DEV_BYPASS !== 'off') still
// short-circuits the login UI locally; set AUTH_DEV_BYPASS=off to exercise this
// path in dev. NOTE: end-to-end sign-in also needs the server half — the real
// Admin SDK `verifyIdToken` in session.ts (P4.2) — which is still stubbed.

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  signInWithPopup,
  signInWithEmailAndPassword,
  getIdToken,
  GoogleAuthProvider,
  type Auth,
} from "firebase/auth";

import { publicEnv } from "../public-env";

export type ProviderId = "google" | "github" | "facebook" | "apple";

/**
 * Popup OAuth providers rendered by the login UI, in display order. Only
 * providers actually ENABLED in the Firebase console belong here. Email/Password
 * is not a popup provider — it has its own `signInWithEmailPassword()` below.
 */
export const PROVIDERS: ReadonlyArray<{ id: ProviderId; label: string }> = [
  { id: "google", label: "Google" },
  // Not enabled in the Firebase console yet. To add one: register its OAuth app,
  // enable the provider in Firebase, then uncomment here AND handle it in
  // signInWithProvider() below.
  // { id: "github", label: "GitHub" },
  // { id: "facebook", label: "Facebook" },
  // { id: "apple", label: "Apple" },
];

/** Lazily initialize the Firebase Web app once (client runtime only). */
function getAuthClient(): Auth {
  const app: FirebaseApp =
    getApps()[0] ??
    initializeApp({
      apiKey: publicEnv.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: publicEnv.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: publicEnv.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      appId: publicEnv.NEXT_PUBLIC_FIREBASE_APP_ID,
      messagingSenderId: publicEnv.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    });
  return getAuth(app);
}

/**
 * Open the given provider's popup, sign in, and return a fresh Firebase ID token
 * for /api/auth/session to verify server-side.
 */
export async function signInWithProvider(id: ProviderId): Promise<string> {
  if (id !== "google") {
    throw new Error(
      `The "${id}" sign-in provider is not enabled yet. Register its OAuth app ` +
        `in the Firebase console and add it to PROVIDERS first.`,
    );
  }
  const cred = await signInWithPopup(getAuthClient(), new GoogleAuthProvider());
  return getIdToken(cred.user, /* forceRefresh */ true);
}

/**
 * Email/Password sign-in. Returns a fresh Firebase ID token for
 * /api/auth/session. Accounts are provisioned by an admin (Firebase console /
 * Admin SDK) — this app does not self-register users, so there is no sign-up
 * call here.
 */
export async function signInWithEmailPassword(
  email: string,
  password: string,
): Promise<string> {
  const cred = await signInWithEmailAndPassword(
    getAuthClient(),
    email,
    password,
  );
  return getIdToken(cred.user, /* forceRefresh */ true);
}
