import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { env } from "../env";
import { getUserByUid } from "../repositories/app-users";
import { SESSION_COOKIE_NAME } from "./constants";
import { verifySession } from "./session";
import type { SessionUser } from "./types";

// ---------------------------------------------------------------------------
// Server-side authorization guards (spec §3/§10, execution-plan P4.3).
//
// SHARED CONTRACT — other agents import from `lib/auth/guards.ts`:
//   • getSessionUser(): Promise<SessionUser | null>
//   • requireScheduler(): Promise<SessionUser>   (throws/redirects on failure)
//   • requireAdmin():     Promise<SessionUser>   (throws/redirects on failure)
//
// These MUST be enforced on the server and are usable in Server Components,
// route handlers, and server actions. Never rely on hidden UI for access
// control (Agent B uses getSessionUser only to hide admin-only nav).
// ---------------------------------------------------------------------------

/** Thrown when a caller is authenticated but lacks the required role. */
export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Resolve the current caller from the session cookie, or `null` if there is no
 * valid session / the user is not authorized.
 *
 * Real path (spec §3): verify the session cookie → UID → look up `app_users` by
 * UID → role. Unknown or deactivated users are DENIED (return null); we never
 * auto-provision. An optional `ALLOWED_EMAIL_DOMAIN` adds a second gate.
 *
 * Dev-bypass path: the stub session already carries the picked role, so no DB
 * lookup is needed (the local dev DB may have no `app_users` row for the stub).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  const identity = await verifySession(raw);
  if (!identity) return null;

  // Dev-bypass stub carries the role directly.
  if (identity.role) {
    return { uid: identity.uid, role: identity.role, email: identity.email };
  }

  // Real path: the DB is the canonical permission store (spec §3).
  const row = await getUserByUid(identity.uid);
  if (!row || !row.active) return null; // deny unknown / deactivated users

  const email = row.email ?? identity.email;
  if (!emailDomainAllowed(email)) return null;

  return { uid: row.uid, role: row.role, email };
}

function emailDomainAllowed(email: string | null): boolean {
  const domain = env.ALLOWED_EMAIL_DOMAIN;
  if (!domain) return true; // guard not configured
  if (!email) return false;
  return email.toLowerCase().endsWith(`@${domain.toLowerCase()}`);
}

/**
 * Require a scheduler-or-admin caller. Redirects unauthenticated users to
 * `/login`; throws `ForbiddenError` if authenticated but under-privileged.
 * Returns the caller on success.
 */
export async function requireScheduler(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "scheduler" && user.role !== "admin") {
    throw new ForbiddenError("Scheduler role required");
  }
  return user;
}

/**
 * Require an admin caller. Redirects unauthenticated users to `/login`; throws
 * `ForbiddenError` if authenticated but not an admin. Returns the caller on
 * success.
 */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") {
    throw new ForbiddenError("Admin role required");
  }
  return user;
}
