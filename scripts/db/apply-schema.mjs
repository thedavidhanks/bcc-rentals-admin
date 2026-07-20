#!/usr/bin/env node
// mirror of storefront scripts/db/apply-schema.mjs (see spec §5): read db/schema.sql
// and apply it to the Neon database. The DDL is idempotent, so this is safe to
// re-run.
//
// ⚠️  WARNING: this targets a SHARED PRODUCTION database (the storefront's Neon
//     instance). ALWAYS run it against the Neon DEV branch first (DATABASE_URL_DEV)
//     and verify, before ever pointing it at the prod branch. A human runs this —
//     agents do not run DDL against the shared DB (see CLAUDE.md safety rails).

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const schemaPath = path.join(repoRoot, "db", "schema.sql");

// Load .env.local if present so DATABASE_URL_DEV / DATABASE_URL are available when
// run locally. Node 22's process.loadEnvFile reads the file at runtime; it does
// not print its contents.
try {
  process.loadEnvFile(path.join(repoRoot, ".env.local"));
} catch {
  // No .env.local (e.g. CI) — rely on the ambient environment instead.
}

// Prefer the dev-branch endpoint. Fall back to DATABASE_URL only with a loud warning.
const devUrl = process.env.DATABASE_URL_DEV;
const prodUrl = process.env.DATABASE_URL;
const connectionString = devUrl ?? prodUrl;
const usingProd = !devUrl && Boolean(prodUrl);

if (!connectionString) {
  console.error(
    "ERROR: neither DATABASE_URL_DEV nor DATABASE_URL is set. Set DATABASE_URL_DEV\n" +
      "       to the Neon dev-branch endpoint and re-run.",
  );
  process.exit(1);
}

if (usingProd) {
  console.warn(
    "\n\x1b[33m⚠️  DATABASE_URL_DEV is not set — falling back to DATABASE_URL, which is the\n" +
      "    SHARED PRODUCTION database. Apply to the dev branch first. Aborting unless you\n" +
      "    explicitly opt in with APPLY_TO_PROD=1.\x1b[0m\n",
  );
  if (process.env.APPLY_TO_PROD !== "1") {
    process.exit(1);
  }
}

const needsSsl =
  connectionString.includes("neon.tech") ||
  connectionString.includes("sslmode=require");

async function main() {
  const sql = await readFile(schemaPath, "utf8");
  const client = new pg.Client({
    connectionString,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });

  console.log(
    `Applying ${path.relative(repoRoot, schemaPath)} to ${
      usingProd ? "PRODUCTION (DATABASE_URL)" : "dev branch (DATABASE_URL_DEV)"
    } ...`,
  );

  await client.connect();
  try {
    // The schema is idempotent DDL with no bind parameters, so it runs as a
    // single multi-statement simple query.
    await client.query(sql);
    console.log("✅ Schema applied successfully (idempotent — safe to re-run).");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("❌ Failed to apply schema:", err);
  process.exit(1);
});
