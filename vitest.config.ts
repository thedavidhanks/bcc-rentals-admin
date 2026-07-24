import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Array form (ordered, regex-capable). First match wins, so the more
    // specific @bcc/scheduler entries precede the broad `@` alias.
    alias: [
      // The real `server-only` package throws when imported outside an RSC.
      // Alias it to an empty stub so repository modules load under Node/vitest.
      {
        find: "server-only",
        replacement: fileURLToPath(
          new URL("./tests/stubs/server-only.ts", import.meta.url),
        ),
      },
      // Mirror tsconfig's `@bcc/scheduler` paths so the P9.2 shims resolve the
      // shared package to its in-tree TypeScript sources under Node/vitest.
      {
        find: /^@bcc\/scheduler$/,
        replacement: fileURLToPath(
          new URL("./packages/scheduler/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@bcc\/scheduler\/(.*)$/,
        replacement:
          fileURLToPath(new URL("./packages/scheduler/src", import.meta.url)) +
          "/$1",
      },
      // Mirror tsconfig's `@/*` path alias so modules that import `@/lib/*`
      // (e.g. lib/scheduler/client.ts) resolve under Node/vitest.
      {
        find: "@",
        replacement: fileURLToPath(new URL("./", import.meta.url)),
      },
    ],
  },
});
