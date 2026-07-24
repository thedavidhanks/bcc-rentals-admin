// Firebase Web SDK sign-in seam (client). Spec §3, execution-plan P4.1.
//
// This is the client-side counterpart to lib/auth/session.ts. It renders no UI;
// it exposes `signInWithProvider()` which returns a Firebase ID token that the
// login form POSTs to /api/auth/session to be exchanged for a session cookie.
//
// Q2 status: the real Firebase project config is not available yet, so this
// throws. The whole app runs on the dev-bypass role picker meanwhile. When Q2
// lands: `npm i firebase`, uncomment the implementation below (config comes from
// lib/public-env's NEXT_PUBLIC_FIREBASE_* values), and the login form's provider
// buttons start working with no other changes.

export type ProviderId = "google" | "github" | "facebook" | "apple";

/** Provider buttons rendered by the login UI, in display order. */
export const PROVIDERS: ReadonlyArray<{ id: ProviderId; label: string }> = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
  { id: "facebook", label: "Facebook" },
  { id: "apple", label: "Apple" },
];

/**
 * Open the given provider's popup, sign in, and return a fresh ID token.
 *
 * TODO(Q2): real implementation (config from lib/public-env `publicEnv`):
 *
 *   import { initializeApp, getApps } from "firebase/app";
 *   import {
 *     getAuth, signInWithPopup, getIdToken,
 *     GoogleAuthProvider, GithubAuthProvider,
 *     FacebookAuthProvider, OAuthProvider,
 *   } from "firebase/auth";
 *   import { publicEnv } from "../public-env";
 *
 *   const app = getApps()[0] ?? initializeApp({
 *     apiKey: publicEnv.NEXT_PUBLIC_FIREBASE_API_KEY,
 *     authDomain: publicEnv.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
 *     projectId: publicEnv.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
 *     appId: publicEnv.NEXT_PUBLIC_FIREBASE_APP_ID,
 *     messagingSenderId: publicEnv.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
 *   });
 *   const provider =
 *     id === "google"   ? new GoogleAuthProvider()
 *   : id === "github"   ? new GithubAuthProvider()
 *   : id === "facebook" ? new FacebookAuthProvider()
 *   :                     new OAuthProvider("apple.com");
 *   const cred = await signInWithPopup(getAuth(app), provider);
 *   return getIdToken(cred.user, true);
 */
export async function signInWithProvider(id: ProviderId): Promise<string> {
  void id;
  throw new Error(
    "Firebase sign-in is not configured yet (Q2). Use the dev role picker while " +
      "running locally.",
  );
}
