import "server-only";

import { executor, type Queryable } from "./shared";
import type { AppUserInsert, AppUserRow, UserRole } from "./types";

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
