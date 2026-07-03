import { defineConfig } from "vitest/config";

// Only own vitest suites (lib/**/__tests__/*.test.js). The repo also carries
// node:test (.test.mjs) and Deno (.test.ts) files that vitest cannot run.
export default defineConfig({
  test: {
    include: ["**/__tests__/**/*.test.js"],
  },
});
