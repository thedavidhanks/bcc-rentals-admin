import "server-only";

import { env } from "../env";
import { SESSION_MAX_AGE_SECONDS } from "./constants";
import type { SessionIdentity, UserRole } from "./types";

// ---------------------------------------------------------------------------
// The auth seam (spec §3, execution-plan P4.1–P4.3).
//
// This is the ONE module that owns "verify a login credential → mint a session
// cookie → read/verify a session cookie". Everything else (middleware, guards,
// route handlers) goes through `createSession()` / `verifySession()` here, so
// swapping the dev-bypass stub for the real Firebase Admin SDK is a change to
// THIS FILE ONLY.
//
// Two modes:
//   • Dev-bypass  (NODE_ENV !== 'production' && AUTH_DEV_BYPASS !== 'off') —
//     the login UI is a role picker; the session cookie is an unsigned, base64url
//     JSON stub that carries { uid, email, role }. No Firebase project needed.
//     This unblocks the rest of the app (P5 shell/calendar, P6 pages) while Q2
//     (real Firebase project config) is outstanding.
//   • Real Firebase (always in production; opt-in locally with AUTH_DEV_BYPASS=off)
//     — verify the client ID token with the Firebase Admin SDK and exchange it
//     for a session cookie via createSessionCookie(); verify that cookie on read.
//     Wired behind `getAdminAuth()` below; throws until Q2 lands.
// ---------------------------------------------------------------------------

/** Thrown by the real Firebase path until the project config (Q2) is available. */
export class AuthNotConfiguredError extends Error {
  constructor(
    message = "Firebase Admin auth is not configured yet (Q2). The dev-bypass " +
      "role picker is available while NODE_ENV !== 'production'.",
  ) {
    super(message);
    this.name = "AuthNotConfiguredError";
  }
}

/**
 * Is the dev-only auth bypass active? Gated on NOT-production so it can never be
 * enabled on Cloud Run, plus an explicit `AUTH_DEV_BYPASS=off` escape hatch to
 * exercise the real Firebase path locally.
 */
export function isDevBypassEnabled(): boolean {
  return env.NODE_ENV !== "production" && env.AUTH_DEV_BYPASS !== "off";
}

export interface MintedSession {
  value: string;
  maxAgeSeconds: number;
}

export interface CreateSessionInput {
  /** Firebase Web SDK ID token (real path). */
  idToken?: string;
  /** Dev-bypass only: the role the developer picked at the login role picker. */
  devRole?: UserRole;
  /** Dev-bypass only: override the stub uid (defaults to `dev-<role>`). */
  uid?: string;
  /** Dev-bypass only: override the stub email. */
  email?: string | null;
}

/**
 * Mint a session cookie value from a login credential.
 *
 * Dev-bypass: encodes the picked role into an unsigned stub cookie.
 * Real path: verifies the ID token and mints a Firebase session cookie.
 */
export async function createSession(
  input: CreateSessionInput,
): Promise<MintedSession> {
  if (isDevBypassEnabled() && input.devRole) {
    const uid = input.uid?.trim() || `dev-${input.devRole}`;
    const email =
      input.email === undefined ? `${uid}@dev.local` : input.email;
    return {
      value: encodeDevCookie({ uid, email, role: input.devRole }),
      maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
    };
  }

  if (!input.idToken) {
    throw new Error(
      "createSession requires an idToken (or a devRole while dev-bypass is enabled).",
    );
  }
  return createRealSession(input.idToken);
}

/**
 * Verify a session cookie and return the caller's identity, or `null` if the
 * cookie is missing/invalid. Role resolution (DB lookup) happens in the guards,
 * not here — this returns identity only for the real path.
 */
export async function verifySession(
  value: string | null | undefined,
): Promise<SessionIdentity | null> {
  if (!value) return null;

  if (value.startsWith(DEV_COOKIE_PREFIX)) {
    // Never honor a stub cookie outside dev-bypass mode (defense in depth: a
    // stray dev cookie must not authenticate anyone in production).
    if (!isDevBypassEnabled()) return null;
    return decodeDevCookie(value);
  }

  return verifyRealSession(value);
}

// ---------------------------------------------------------------------------
// Dev-bypass stub cookie codec (unsigned — local development only).
// ---------------------------------------------------------------------------

const DEV_COOKIE_PREFIX = "dev.";

interface DevCookiePayload {
  uid: string;
  email: string | null;
  role: UserRole;
}

function encodeDevCookie(payload: DevCookiePayload): string {
  const json = JSON.stringify({ ...payload, iat: Date.now() });
  return DEV_COOKIE_PREFIX + Buffer.from(json, "utf8").toString("base64url");
}

function decodeDevCookie(value: string): SessionIdentity | null {
  try {
    const json = Buffer.from(
      value.slice(DEV_COOKIE_PREFIX.length),
      "base64url",
    ).toString("utf8");
    const parsed = JSON.parse(json) as Partial<DevCookiePayload>;
    if (
      typeof parsed.uid !== "string" ||
      (parsed.role !== "scheduler" && parsed.role !== "admin")
    ) {
      return null;
    }
    return {
      uid: parsed.uid,
      email: typeof parsed.email === "string" ? parsed.email : null,
      role: parsed.role,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Real Firebase Admin path (Q2 seam).
//
// When the Firebase project config lands: `npm i firebase-admin`, implement
// getAdminAuth(), and the two functions below start working with no changes
// elsewhere in the app.
// ---------------------------------------------------------------------------

async function createRealSession(idToken: string): Promise<MintedSession> {
  const auth = getAdminAuth();
  // TODO(Q2): once getAdminAuth() returns a real Firebase Auth instance:
  //   await auth.verifyIdToken(idToken, true); // reject revoked/invalid tokens
  //   const value = await auth.createSessionCookie(idToken, {
  //     expiresIn: SESSION_MAX_AGE_SECONDS * 1000,
  //   });
  //   return { value, maxAgeSeconds: SESSION_MAX_AGE_SECONDS };
  void auth;
  void idToken;
  throw new AuthNotConfiguredError();
}

async function verifyRealSession(
  value: string,
): Promise<SessionIdentity | null> {
  const auth = getAdminAuth();
  // TODO(Q2): once getAdminAuth() returns a real Firebase Auth instance:
  //   const decoded = await auth.verifySessionCookie(value, true);
  //   return { uid: decoded.uid, email: decoded.email ?? null };
  void auth;
  void value;
  throw new AuthNotConfiguredError();
}

/**
 * Returns the Firebase Admin `Auth` instance. Throws until Q2 lands.
 *
 * TODO(Q2): implement with the Admin SDK. On Cloud Run use Application Default
 * Credentials from the runtime service account (no key file); locally use
 * GOOGLE_APPLICATION_CREDENTIALS. Sketch:
 *
 *   import { getApps, initializeApp, applicationDefault, cert } from "firebase-admin/app";
 *   import { getAuth, type Auth } from "firebase-admin/auth";
 *   let cached: Auth | undefined;
 *   function getAdminAuth(): Auth {
 *     if (cached) return cached;
 *     const app = getApps()[0] ?? initializeApp({
 *       projectId: env.FIREBASE_PROJECT_ID,
 *       credential: env.GOOGLE_APPLICATION_CREDENTIALS
 *         ? cert(env.GOOGLE_APPLICATION_CREDENTIALS)
 *         : applicationDefault(),
 *     });
 *     cached = getAuth(app);
 *     return cached;
 *   }
 */
function getAdminAuth(): never {
  throw new AuthNotConfiguredError();
}
