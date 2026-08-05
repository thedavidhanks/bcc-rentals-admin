import "server-only";

import { readFileSync } from "node:fs";

import {
  getApps,
  initializeApp,
  applicationDefault,
  cert,
  type App,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";

import { env } from "../env";
import { SESSION_MAX_AGE_SECONDS } from "./constants";
import type { SessionIdentity, UserRole } from "./types";

// ---------------------------------------------------------------------------
// The auth seam (spec §3, execution-plan P4.1–P4.3).
//
// This is the ONE module that owns "verify a login credential → mint a session
// cookie → read/verify a session cookie". Everything else (middleware, guards,
// route handlers) goes through `createSession()` / `verifySession()` here, so
// the dev-bypass stub and the real Firebase Admin SDK live side by side in
// THIS FILE ONLY.
//
// Two modes:
//   • Dev-bypass  (NODE_ENV !== 'production' && AUTH_DEV_BYPASS !== 'off') —
//     the login UI is a role picker; the session cookie is an unsigned, base64url
//     JSON stub that carries { uid, email, role }. No Firebase project needed.
//     Handy for local work without hitting Firebase.
//   • Real Firebase (always in production; opt-in locally with AUTH_DEV_BYPASS=off)
//     — verify the client ID token with the Firebase Admin SDK and exchange it
//     for a session cookie via createSessionCookie(); verify that cookie on read.
//     Implemented via getAdminAuth() below (P4.2, Q2 answered 2026-07-26).
//
// Runtime note: this module `import "server-only"` and pulls in firebase-admin,
// so it runs on the Node runtime only (guards + the /api/auth/session route).
// middleware.ts (Edge) must NOT import it — it does a cookie-presence check with
// constants.ts only.
// ---------------------------------------------------------------------------

/**
 * Retained for callers that still reference it. The real path no longer throws
 * this — a misconfigured Admin SDK surfaces firebase-admin's own init error.
 */
export class AuthNotConfiguredError extends Error {
  constructor(message = "Firebase Admin auth is not configured.") {
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
// Real Firebase Admin path (P4.2, Q2 answered 2026-07-26).
// ---------------------------------------------------------------------------

/**
 * Verify the client ID token and exchange it for a Firebase session cookie.
 * `verifyIdToken(..., true)` rejects revoked/invalid tokens before we mint the
 * longer-lived cookie. Throws on an invalid token — the /api/auth/session route
 * catches it and returns 401.
 */
async function createRealSession(idToken: string): Promise<MintedSession> {
  const auth = getAdminAuth();
  await auth.verifyIdToken(idToken, true);
  const value = await auth.createSessionCookie(idToken, {
    expiresIn: SESSION_MAX_AGE_SECONDS * 1000, // Firebase expects milliseconds
  });
  return { value, maxAgeSeconds: SESSION_MAX_AGE_SECONDS };
}

/**
 * Verify a Firebase session cookie and return the caller's identity. Returns
 * `null` (not throws) on an invalid/expired/revoked cookie so callers treat it
 * as "not signed in" — mirrors the dev-cookie path. Role resolution is the
 * guards' job (UID → app_users), not this module's.
 */
async function verifyRealSession(
  value: string,
): Promise<SessionIdentity | null> {
  const auth = getAdminAuth();
  try {
    const decoded = await auth.verifySessionCookie(value, /* checkRevoked */ true);
    return { uid: decoded.uid, email: decoded.email ?? null };
  } catch {
    return null;
  }
}

/**
 * The Firebase Admin `Auth` instance, initialized once and cached.
 *
 * Credential resolution (all paths ultimately provide a signing identity, which
 * `createSessionCookie` requires):
 *   • Cloud Run: GOOGLE_APPLICATION_CREDENTIALS unset → applicationDefault()
 *     picks up the runtime service account (it can sign via IAM).
 *   • Local dev with a service-account KEY file (`type: "service_account"`):
 *     use cert(). (Discouraged here — the org policy blocks minting these keys.)
 *   • Local dev with an ADC file — a plain user login (`type: "authorized_user"`,
 *     which CANNOT sign) or, the supported setup, an impersonated service account
 *     (`type: "impersonated_service_account"`, which CAN sign via signBlob):
 *     fall through to applicationDefault(), which the google-auth library
 *     resolves from GOOGLE_APPLICATION_CREDENTIALS itself and handles natively.
 *
 * cert() ONLY accepts a service-account key JSON, so we must not route an ADC
 * file through it — hence the `type` peek below.
 */
let cachedAuth: Auth | undefined;

/**
 * True when the JSON at `path` is a raw service-account KEY (the only shape
 * cert() accepts). Everything else — user ADC, impersonated-SA ADC, or an
 * unreadable/malformed file — returns false so we defer to applicationDefault().
 */
function isServiceAccountKeyFile(path: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { type?: string };
    return parsed.type === "service_account";
  } catch {
    return false;
  }
}

function getAdminAuth(): Auth {
  if (cachedAuth) return cachedAuth;
  const credsPath = env.GOOGLE_APPLICATION_CREDENTIALS;
  const app: App =
    getApps()[0] ??
    initializeApp({
      projectId: env.FIREBASE_PROJECT_ID,
      credential:
        credsPath && isServiceAccountKeyFile(credsPath)
          ? cert(credsPath)
          : applicationDefault(),
    });
  cachedAuth = getAuth(app);
  return cachedAuth;
}
