import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * Vitest config for non-DB unit tests. Modules that touch Drizzle/Neon
 * are tested either with mocks (here) or via integration scripts later.
 *
 * For the first pass we focus on pure-function modules: prompt parser,
 * filename builder, error-message translator. These have the highest
 * regression risk per refactor and zero infrastructure dependencies.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    globals: false,
  },
});
