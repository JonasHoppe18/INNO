import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

// Only own vitest suites (lib/**/__tests__/*.test.js). The repo also carries
// node:test (.test.mjs) and Deno (.test.ts) files that vitest cannot run.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    include: ["**/__tests__/**/*.test.js"],
  },
});
