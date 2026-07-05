import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Paid end-to-end harness for the deep-think pipeline: runs the production
// reasoning/agent code against the REAL OpenRouter API (key from .env) with the
// Tauri layer shimmed to Node fs. Never part of `npm test`.
// Run with: npm run e2e:deepthink
export default defineConfig({
  resolve: {
    alias: {
      "@tauri-apps/api/core": fileURLToPath(new URL("./tauriShim.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["e2e/**/*.e2e.ts"],
    testTimeout: 1_800_000,
    hookTimeout: 120_000,
    // Sequential: the two scenarios share the call log and API budget.
    fileParallelism: false,
  },
});
