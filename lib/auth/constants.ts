// Auth constants shared across runtimes.
//
// This module has NO dependencies and NO `import "server-only"` on purpose: it is
// imported by `middleware.ts` (which runs in the Edge runtime, where server-only
// and Node/pg/firebase-admin code cannot load) as well as by the Node-runtime
// route handlers, guards, and session module. Keep it dependency-free.

/** Name of the httpOnly session cookie the app sets on login and reads everywhere. */
export const SESSION_COOKIE_NAME = "bcc_admin_session";

/**
 * Session lifetime in seconds (5 days). In the real Firebase path this is passed
 * to `createSessionCookie({ expiresIn })` (Firebase caps session cookies at 14
 * days); it also drives the browser cookie `Max-Age`.
 */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 5;
