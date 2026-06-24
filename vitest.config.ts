import { defineConfig } from "vitest/config";

// Unit tests for pure logic (no DOM/Tauri). Kept separate from vite.config.ts
// so the Tauri dev-server config isn't pulled into the test runner.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
