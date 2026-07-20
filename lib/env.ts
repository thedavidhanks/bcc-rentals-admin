import "server-only";

import { z } from "zod";
import { publicEnv, type PublicEnv } from "./public-env";

// mirror of storefront lib/env.ts (see spec §11): validate the admin var set with
// Zod at module load so the app FAILS TO START if a required var is missing.
//
// Server-only secrets live here and must never be imported into a client bundle
// (the `import "server-only"` above enforces that at build time). Client-safe
// `NEXT_PUBLIC_*` values come from `./public-env`, which is importable anywhere.

const serverEnvSchema = z.object({
  // Neon POOLED endpoint, main (prod) branch — same DB as the storefront.
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  // Neon dev-branch direct endpoint, for one-off DDL/tooling only.
  DATABASE_URL_DEV: z.string().min(1).optional(),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  // Firebase Admin SDK project id (same GCP project as the Web SDK config).
  FIREBASE_PROJECT_ID: z.string().min(1, "FIREBASE_PROJECT_ID is required"),
  // Admin SDK credentials for LOCAL DEV ONLY; on Cloud Run use the runtime
  // service account's Application Default Credentials (no key file).
  GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1).optional(),
  // Optional extra guard layered on top of the app_users lookup.
  ALLOWED_EMAIL_DOMAIN: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type Env = ServerEnv & PublicEnv;

const parsed = serverEnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  throw new Error(
    `Invalid server environment. The app cannot start until these are fixed:\n${issues}`,
  );
}

// Combine validated server env with the client-safe public env so server code
// has a single typed `env` object to read from.
export const env: Env = { ...parsed.data, ...publicEnv };
