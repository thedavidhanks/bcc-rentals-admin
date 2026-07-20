import "server-only";

import type { Pool, PoolClient } from "pg";
import { getPool } from "../db";

// Shared plumbing for the typed repositories (spec §4/§5).
//
// Every repository function accepts an OPTIONAL `Queryable` so it can run either
// on the process-wide pool (default) or inside a caller-supplied transaction
// (`withTransaction`'s PoolClient). This is what lets the race-safe reservation
// engine (P2) and the audit-log writer (P3.2) participate in one atomic write.

/** A pg handle that can run a query — either the pool or a transaction client. */
export type Queryable = Pool | PoolClient;

/** Resolve the executor: the caller's transaction client, or the shared pool. */
export function executor(client?: Queryable): Queryable {
  return client ?? getPool();
}

/**
 * Build a dynamic `SET` clause from a patch object, emitting only the columns
 * that are explicitly present (`!== undefined`). `null` IS emitted so a column
 * can be cleared. Returns the clause, its ordered values, and the next
 * positional-parameter index so callers can append (e.g. a WHERE id = $N).
 */
export function buildSet(
  patch: Record<string, unknown>,
  columns: readonly string[],
  startIndex = 1,
): { clause: string; values: unknown[]; nextIndex: number } {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = startIndex;
  for (const col of columns) {
    if (patch[col] !== undefined) {
      sets.push(`${col} = $${i}`);
      values.push(patch[col]);
      i += 1;
    }
  }
  return { clause: sets.join(", "), values, nextIndex: i };
}
