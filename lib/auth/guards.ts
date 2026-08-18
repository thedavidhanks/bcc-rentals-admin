import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { env } from "../env";
import { withTransaction } from "../db";
import { bindInvite, getUserByUid } from "../repositories/app-users";
import { writeAuditLog } from "../repositories/audit-log";
import type { AppUserRow } from "../repositories/types";
import { SESSION_COOKIE_NAME } from "./constants";
import { verifySession } from "./session";
import type { SessionIdentity, SessionUser } from "./types";

// Re-export the canonical role union from the auth barrel so callers that only
// need the role type (e.g. nav filtering) import it from here alongside the guards.
export type { UserRole } from "./types";

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
  let row = await getUserByUid(identity.uid);

  // P6.6 invite binding. A signed-in UID with no app_users row is normally an
  // unknown user → deny (no auto-provisioning of roles). But if this is the
  // invitee's first sign-in with a VERIFIED email that matches a pending invite,
  // bind their real UID to that invite and proceed as that user.
  //
  // Spec §3 reconciliation: UID remains the durable, canonical key. Email is used
  // exactly ONCE here — to match a pending invite to a signing-in person — after
  // which the UID is authoritative forever (a returning user is found by
  // getUserByUid above and never reaches this bind path). email_verified === true
  // is required so a spoofed/unverified address can't hijack someone's invite. A
  // UID already bound is found above and never re-binds; the invite UPDATE is
  // scoped `WHERE uid IS NULL`, so an invite binds at most once even under a race.
  if (!row && identity.email_verified === true) {
    row = await tryBindInvite(identity);
  }

  if (!row || !row.active || row.uid === null) return null; // deny unknown / deactivated

  const email = row.email ?? identity.email;
  if (!emailDomainAllowed(email)) return null;

  return { uid: row.uid, role: row.role, email };
}

/**
 * Attempt to bind a verified first-sign-in identity to a pending invite, auditing
 * the bind in the same transaction. Returns the bound row, or null if no open
 * invite matched (→ caller keeps the deny-unknown behavior). A bind must never
 * fail sign-in resolution loudly: any binding error resolves to "no bind" (null).
 */
async function tryBindInvite(
  identity: SessionIdentity,
): Promise<AppUserRow | null> {
  if (!identity.email) return null;
  try {
    return await withTransaction(async (client) => {
      const bound = await bindInvite(
        { email: identity.email as string, uid: identity.uid },
        client,
      );
      if (!bound) return null;
      await writeAuditLog(
        {
          actor_uid: identity.uid, // actor = the binding user themselves
          actor_email: bound.email ?? identity.email,
          action: "user.invite.bind",
          entity: "app_users",
          entity_id: bound.id,
          detail: {
            before: { uid: null, active: false },
            after: { uid: bound.uid, role: bound.role, active: bound.active },
          },
        },
        client,
      );
      return bound;
    });
  } catch {
    return null;
  }
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
