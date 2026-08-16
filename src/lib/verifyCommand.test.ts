import { describe, it, expect } from "vitest";
import { inferVerifyCommand, detectVerifyCommand } from "./verifyCommand";

describe("inferVerifyCommand", () => {
  it("prefers the package.json test script over everything else", () => {
    expect(
      inferVerifyCommand({
        packageJsonScripts: { test: "vitest run", build: "tsc" },
        hasCargoToml: true,
        hasPyprojectToml: true,
      }),
    ).toBe("npm test");
  });

  it("falls back to the build script when there is no test script", () => {
    expect(
      inferVerifyCommand({
        packageJsonScripts: { build: "tsc && vite build" },
        hasCargoToml: true,
        hasPyprojectToml: true,
      }),
    ).toBe("npm run build");
  });

  it("falls back to cargo test when there is no package.json signal", () => {
    expect(
      inferVerifyCommand({ packageJsonScripts: null, hasCargoToml: true, hasPyprojectToml: true }),
    ).toBe("cargo test");
  });

  it("falls back to pytest when only pyproject.toml is present", () => {
    expect(
      inferVerifyCommand({ packageJsonScripts: null, hasCargoToml: false, hasPyprojectToml: true }),
    ).toBe("pytest");
  });

  it("returns empty string when nothing is recognized", () => {
    expect(
      inferVerifyCommand({ packageJsonScripts: null, hasCargoToml: false, hasPyprojectToml: false }),
    ).toBe("");
  });

  it("ignores a package.json with scripts present but neither test nor build", () => {
    expect(
      inferVerifyCommand({
        packageJsonScripts: { start: "node index.js" },
        hasCargoToml: false,
        hasPyprojectToml: false,
      }),
    ).toBe("");
  });
});

describe("detectVerifyCommand", () => {
  it("parses package.json and picks the test script", async () => {
    const files: Record<string, string> = {
      "/repo/package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
    };
    const reader = async (p: string) => files[p] ?? null;
    expect(await detectVerifyCommand("/repo", reader)).toBe("npm test");
  });

  it("tolerates a trailing slash on the workspace root", async () => {
    const files: Record<string, string> = {
      "/repo/package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
    };
    const reader = async (p: string) => files[p] ?? null;
    expect(await detectVerifyCommand("/repo/", reader)).toBe("npm test");
  });

  it("falls back gracefully when package.json is present but unparseable", async () => {
    const files: Record<string, string> = { "/repo/package.json": "{ not json" };
    const reader = async (p: string) => files[p] ?? null;
    expect(await detectVerifyCommand("/repo", reader)).toBe("");
  });

  it("detects Cargo.toml when there is no package.json", async () => {
    const files: Record<string, string> = { "/repo/Cargo.toml": "[package]\nname = \"x\"" };
    const reader = async (p: string) => files[p] ?? null;
    expect(await detectVerifyCommand("/repo", reader)).toBe("cargo test");
  });

  it("returns empty string when no manifest is found", async () => {
    const reader = async () => null;
    expect(await detectVerifyCommand("/repo", reader)).toBe("");
  });
});
