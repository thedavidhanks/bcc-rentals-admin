import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    alias: {
      // The real `server-only` package throws when imported outside an RSC.
      // Alias it to an empty stub so repository modules load under Node/vitest.
      "server-only": fileURLToPath(
        new URL("./tests/stubs/server-only.ts", import.meta.url),
      ),
      // Mirror tsconfig's `@/*` path alias so modules that import `@/lib/*`
      // (e.g. lib/scheduler/client.ts) resolve under Node/vitest.
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
