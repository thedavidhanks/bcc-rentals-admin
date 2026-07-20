import "server-only";

import { Pool, type PoolClient } from "pg";
import { env } from "./env";

// mirror of storefront lib/scheduler/db.ts (see spec §2): a singleton pg Pool via
// getPool() plus a withTransaction() helper. Runtime queries use the Neon POOLED
// endpoint (DATABASE_URL). Wrap multi-statement writes in withTransaction().

let pool: Pool | undefined;

/**
 * Returns the process-wide pg Pool, creating it on first use. Reuse across
 * requests avoids exhausting connections (important on scale-to-zero Cloud Run).
 */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = env.DATABASE_URL;
    pool = new Pool({
      connectionString,
      // Neon requires TLS. The connection string carries `sslmode=require`; enable
      // ssl explicitly so pg negotiates TLS regardless of how it parses the URL.
      ssl: needsSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

function needsSsl(connectionString: string): boolean {
  return (
    connectionString.includes("neon.tech") ||
    connectionString.includes("sslmode=require")
  );
}

/**
 * Runs `fn` inside a single transaction: BEGIN, then the callback with a
 * dedicated client, then COMMIT. On any error it ROLLBACKs and rethrows. The
 * client is always released back to the pool.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback failures (e.g. the connection is already broken) so the
      // original error below is what propagates.
    }
    throw err;
  } finally {
    client.release();
  }
}
