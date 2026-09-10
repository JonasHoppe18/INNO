import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

// Only own vitest suites (lib/**/__tests__/*.test.js). The repo also carries
// node:test (.test.mjs) and Deno (.test.ts) files that vitest cannot run.
export default defineConfig({
  resolve: {
    alias: {
      "@": appRoot,
    },
  },
  test: {
    include: ["**/__tests__/**/*.test.js"],
  },
});
