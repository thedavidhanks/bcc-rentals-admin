import "server-only";

import { executor, type Queryable } from "./shared";
import type {
  AppUserBindInput,
  AppUserInsert,
  AppUserInviteInsert,
  AppUserRow,
  UserRole,
} from "./types";

// Repository for the admin-owned `app_users` table (spec §5). The Firebase UID
// is the durable account id; `role` is the canonical permission store. Authorize
// off the UID, never the email. Unknown UID → caller denies access (no
// auto-provisioning). Deactivate rather than delete.

const USER_COLUMNS = `
  id, uid, email, name, role, active, last_login, created_at, updated_at
`;

/** The authorization lookup: verified UID → account row (or null = deny). */
export async function getUserByUid(
  uid: string,
  client?: Queryable,
): Promise<AppUserRow | null> {
  const { rows } = await executor(client).query<AppUserRow>(
    `SELECT ${USER_COLUMNS} FROM app_users WHERE uid = $1`,
    [uid],
  );
  return rows[0] ?? null;
}

export async function getUserById(
  id: string,
  client?: Queryable,
): Promise<AppUserRow | null> {
  const { rows } = await executor(client).query<AppUserRow>(
    `SELECT ${USER_COLUMNS} FROM app_users WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function listUsers(
  opts: { activeOnly?: boolean } = {},
  client?: Queryable,
): Promise<AppUserRow[]> {
  const where = opts.activeOnly ? "WHERE active = true" : "";
  const { rows } = await executor(client).query<AppUserRow>(
    `SELECT ${USER_COLUMNS} FROM app_users ${where}
     ORDER BY role ASC, lower(email) ASC NULLS LAST`,
  );
  return rows;
}

/**
 * Insert (or, on UID conflict, revive/update) an account. Email is stored
 * lower-cased. Doubles as the bootstrap-first-admin upsert (spec §5).
 */
export async function upsertUser(
  input: AppUserInsert,
  client?: Queryable,
): Promise<AppUserRow> {
  const { rows } = await executor(client).query<AppUserRow>(
    `INSERT INTO app_users (uid, email, name, role, active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, COALESCE($5, true), now(), now())
     ON CONFLICT (uid) DO UPDATE SET
       email = EXCLUDED.email,
       name = EXCLUDED.name,
       role = EXCLUDED.role,
       active = EXCLUDED.active,
       updated_at = now()
     RETURNING ${USER_COLUMNS}`,
    [
      input.uid,
      input.email ? input.email.toLowerCase() : null,
      input.name ?? null,
      input.role,
      input.active ?? null,
    ],
  );
  return rows[0];
}

export async function updateUserRole(
  uid: string,
  role: UserRole,
  client?: Queryable,
): Promise<AppUserRow | null> {
  const { rows } = await executor(client).query<AppUserRow>(
    `UPDATE app_users SET role = $2, updated_at = now() WHERE uid = $1
     RETURNING ${USER_COLUMNS}`,
    [uid, role],
  );
  return rows[0] ?? null;
}

export async function setUserActive(
  uid: string,
  active: boolean,
  client?: Queryable,
): Promise<AppUserRow | null> {
  const { rows } = await executor(client).query<AppUserRow>(
    `UPDATE app_users SET active = $2, updated_at = now() WHERE uid = $1
     RETURNING ${USER_COLUMNS}`,
    [uid, active],
  );
  return rows[0] ?? null;
}

export async function updateLastLogin(
  uid: string,
  when: Date = new Date(),
  client?: Queryable,
): Promise<void> {
  await executor(client).query(
    `UPDATE app_users SET last_login = $2 WHERE uid = $1`,
    [uid, when],
  );
}

/** Count active admins — used to guard against removing the last one (spec §6). */
export async function countActiveAdmins(client?: Queryable): Promise<number> {
  const { rows } = await executor(client).query<{ count: string }>(
    `SELECT COUNT(*)::int AS count FROM app_users
      WHERE role = 'admin' AND active = true`,
  );
  return Number(rows[0]?.count ?? 0);
}

// ---------------------------------------------------------------------------
// Invite-by-email onboarding (P6.6).
//
// A pending invite is a real app_users row with uid=NULL, active=false, and a
// preset role/email/name. The invitee's real Firebase UID is bound on their
// first VERIFIED sign-in (see bindInvite + lib/auth/guards.getSessionUser).
// UID remains the durable, canonical key (spec §3) — email is used ONCE only to
// match the pending invite, then the UID is authoritative forever.
// ---------------------------------------------------------------------------

/** Thrown by createInvite when an open invite already exists for the email. */
export class InviteAlreadyExistsError extends Error {
  constructor(email: string) {
    super(`An open invite already exists for ${email}.`);
    this.name = "InviteAlreadyExistsError";
  }
}

/** The open invite (uid IS NULL) for a lower-cased email, or null. */
export async function getPendingInviteByEmail(
  email: string,
  client?: Queryable,
): Promise<AppUserRow | null> {
  const { rows } = await executor(client).query<AppUserRow>(
    `SELECT ${USER_COLUMNS} FROM app_users
      WHERE uid IS NULL AND lower(email) = lower($1)`,
    [email],
  );
  return rows[0] ?? null;
}

/**
 * Create a pending invite (uid=NULL, active=false). Email is stored lower-cased.
 * Rejects with InviteAlreadyExistsError if an open invite already exists for the
 * address (pre-checked, and backstopped by the `app_users_pending_email_key`
 * partial unique index which surfaces Postgres error 23505).
 */
export async function createInvite(
  input: AppUserInviteInsert,
  client?: Queryable,
): Promise<AppUserRow> {
  const email = input.email.toLowerCase();

  const existing = await getPendingInviteByEmail(email, client);
  if (existing) throw new InviteAlreadyExistsError(email);

  try {
    const { rows } = await executor(client).query<AppUserRow>(
      `INSERT INTO app_users (uid, email, name, role, active, created_at, updated_at)
       VALUES (NULL, $1, $2, $3, false, now(), now())
       RETURNING ${USER_COLUMNS}`,
      [email, input.name ?? null, input.role],
    );
    return rows[0];
  } catch (err) {
    // Race backstop: the partial unique index rejects a concurrent duplicate.
    if (isUniqueViolation(err)) throw new InviteAlreadyExistsError(email);
    throw err;
  }
}

/**
 * Atomically bind a real UID to the matching pending invite: attach the UID, set
 * active=true, refresh name/last_login. Returns the bound row, or null if no open
 * invite matched. Race-safe: the single `UPDATE ... WHERE uid IS NULL` is atomic,
 * so one invite binds at most once — a second concurrent bind finds no open row.
 */
export async function bindInvite(
  input: AppUserBindInput,
  client?: Queryable,
): Promise<AppUserRow | null> {
  const { rows } = await executor(client).query<AppUserRow>(
    `UPDATE app_users
        SET uid = $2,
            name = COALESCE($3, name),
            active = true,
            last_login = now(),
            updated_at = now()
      WHERE uid IS NULL AND lower(email) = lower($1)
      RETURNING ${USER_COLUMNS}`,
    [input.email, input.uid, input.name ?? null],
  );
  return rows[0] ?? null;
}

/**
 * Cancel a pending invite by id. Hard-scoped to `uid IS NULL` so a bound account
 * can never be deleted this way (bound accounts are deactivated, never deleted).
 * Returns true if a pending row was removed.
 */
export async function revokeInvite(
  id: string,
  client?: Queryable,
): Promise<boolean> {
  const result = await executor(client).query(
    `DELETE FROM app_users WHERE id = $1 AND uid IS NULL`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

/** True for a Postgres unique-violation (SQLSTATE 23505). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}
