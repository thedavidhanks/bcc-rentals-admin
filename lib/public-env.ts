import { z } from "zod";

/**
 * Client-safe environment.
 *
 * This module holds ONLY `NEXT_PUBLIC_*` values, which are not secrets and are
 * inlined into the browser bundle at build time. It deliberately does NOT
 * `import "server-only"` so it can be imported from client components (e.g. the
 * Firebase Web SDK config) — keep server secrets in `lib/env.ts` instead.
 *
 * Next.js only inlines `process.env.NEXT_PUBLIC_*` when it sees each reference
 * as a literal member expression, so we read each var explicitly here rather
 * than parsing `process.env` wholesale.
 */
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z
    .string()
    .url("NEXT_PUBLIC_SITE_URL must be a valid URL, e.g. https://admin.bachmancc.org"),
  NEXT_PUBLIC_FIREBASE_API_KEY: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_APP_ID: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: z.string().min(1).optional(),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

const rawPublicEnv = {
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
};

const parsed = publicEnvSchema.safeParse(rawPublicEnv);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  // Fail fast: a missing public Firebase var means sign-in cannot work.
  throw new Error(
    `Invalid public environment (NEXT_PUBLIC_*). Fix these and rebuild:\n${issues}`,
  );
}

export const publicEnv: PublicEnv = parsed.data;
