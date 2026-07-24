// Auth types shared by the session module, guards, route handlers, and the
// client sign-in UI. Types only (erased at build) so this is safe to import from
// any runtime; it deliberately does NOT `import "server-only"`.

import type { UserRole } from "../repositories/types";

// Re-export the canonical role union so auth callers don't reach into the
// repository layer for it.
export type { UserRole };

/**
 * The authenticated + authorized caller, as returned by `getSessionUser()`.
 * `role` is resolved from the canonical permission store (`app_users.role` in the
 * real path; the dev-bypass stub in local dev). `email` is display/contact only.
 */
export interface SessionUser {
  uid: string;
  role: UserRole;
  email: string | null;
}

/**
 * The identity carried by a verified session cookie, BEFORE role resolution.
 *
 * - Real Firebase path: `{ uid, email }` come from the verified session cookie;
 *   `role` is `undefined` (the DB is the source of truth — see spec §3).
 * - Dev-bypass path: `role` is present because the stub cookie encodes the role
 *   the developer picked at login.
 */
export interface SessionIdentity {
  uid: string;
  email: string | null;
  role?: UserRole;
}
