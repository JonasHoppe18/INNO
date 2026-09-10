import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL(".", import.meta.url));

// Only own vitest suites (lib/**/__tests__/*.test.js). The repo also carries
// node:test (.test.mjs) and Deno (.test.ts) files that vitest cannot run.
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(webRoot, "."),
    },
  },
  test: {
    include: ["**/__tests__/**/*.test.js"],
  },
});
