import "server-only";

import { executor, type Queryable } from "./shared";
import type { AuditLogInsert, AuditLogRow } from "./types";

// Writer for the admin-owned `admin_audit_log` table (spec §5, P3.2). CALL ON
// EVERY MUTATION. Records who (actor_uid/email), what (action), on which entity
// (entity/entity_id), and a before/after or payload detail JSON.
//
// Designed to run INSIDE the same transaction as the mutation it records: pass
// the mutation's transaction `client` so the audit row commits atomically with
// the change (no orphan audit entries, no unaudited writes). `detail` is stored
// as jsonb — node-pg serializes a plain object automatically; we normalize
// undefined → null so the column is explicit.

export async function writeAuditLog(
  entry: AuditLogInsert,
  client?: Queryable,
): Promise<AuditLogRow> {
  const detail =
    entry.detail === undefined ? null : (JSON.stringify(entry.detail) as string);
  const { rows } = await executor(client).query<AuditLogRow>(
    `INSERT INTO admin_audit_log (
       actor_uid, actor_email, action, entity, entity_id, detail, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
     RETURNING id, actor_uid, actor_email, action, entity, entity_id, detail, created_at`,
    [
      entry.actor_uid,
      entry.actor_email ?? null,
      entry.action,
      entry.entity,
      entry.entity_id ?? null,
      detail,
    ],
  );
  return rows[0];
}
