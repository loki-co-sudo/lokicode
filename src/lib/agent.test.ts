import { describe, it, expect, afterEach } from "vitest";
import { commandRisk, toolNeedsApproval, withinWorkspace, initPathCaseSensitivity } from "./agent";

describe("commandRisk", () => {
  it("treats read-only commands as safe (incl. PowerShell Format-*)", () => {
    // Regression: `Format-Table` must NOT match the disk-`format` rule.
    expect(commandRisk('Select-String -Path README.md -Pattern "x" | Format-Table')).toBe("safe");
    expect(commandRisk("Get-Content package.json")).toBe("safe");
    expect(commandRisk("ls -la | grep foo")).toBe("safe");
    expect(commandRisk('powershell -Command "Get-ChildItem | Format-List"')).toBe("safe");
  });

  it("flags destructive commands", () => {
    expect(commandRisk("rm -rf build")).toBe("destructive");
    expect(commandRisk("Remove-Item -Recurse dist")).toBe("destructive");
    expect(commandRisk("del notes.txt")).toBe("destructive");
    expect(commandRisk("format C:")).toBe("destructive");
  });

  it("treats read-only git as safe but mutating git as git-write", () => {
    expect(commandRisk("git status")).toBe("safe");
    expect(commandRisk("git log --oneline -n 20")).toBe("safe");
    expect(commandRisk("git diff HEAD~1")).toBe("safe");
    expect(commandRisk("git commit -m 'x'")).toBe("git-write");
    expect(commandRisk("git push origin main")).toBe("git-write");
    expect(commandRisk("git reset --hard HEAD")).toBe("git-write");
    expect(commandRisk("git branch -D feature")).toBe("git-write");
  });

  it("auto-approves unknown non-destructive commands (treated safe)", () => {
    expect(commandRisk("npm run build")).toBe("safe");
    expect(commandRisk("node script.js")).toBe("safe");
  });
});

describe("toolNeedsApproval", () => {
  const cmd = (command: string) => ({ command });

  it("manual confirms every risky tool", () => {
    expect(toolNeedsApproval("manual", "write_file", { path: "a" })).toBe(true);
    expect(toolNeedsApproval("manual", "run_command", cmd("git status"))).toBe(true);
    expect(toolNeedsApproval("manual", "read_file", { path: "a" })).toBe(false);
  });

  it("auto confirms nothing", () => {
    expect(toolNeedsApproval("auto", "write_file", { path: "a" })).toBe(false);
    expect(toolNeedsApproval("auto", "run_command", cmd("rm -rf x"))).toBe(false);
  });

  it("standard confirms only destructive / git-write commands", () => {
    expect(toolNeedsApproval("standard", "write_file", { path: "a" })).toBe(false);
    expect(toolNeedsApproval("standard", "run_command", cmd("git status"))).toBe(false);
    expect(toolNeedsApproval("standard", "run_command", cmd("npm run build"))).toBe(false);
    expect(toolNeedsApproval("standard", "run_command", cmd("git push"))).toBe(true);
    expect(toolNeedsApproval("standard", "run_command", cmd("rm -rf dist"))).toBe(true);
  });
});

describe("withinWorkspace path case-sensitivity (initPathCaseSensitivity)", () => {
  afterEach(() => initPathCaseSensitivity("windows")); // restore the default (case-insensitive)

  it("defaults to case-insensitive (Windows/macOS FS behavior)", () => {
    expect(withinWorkspace("/Home/X/file.ts", "/home/x")).toBe(true);
  });

  it("treats differently-cased paths as distinct on Linux (case-sensitive FS)", () => {
    initPathCaseSensitivity("linux");
    expect(withinWorkspace("/Home/X/file.ts", "/home/x")).toBe(false);
    // Same-case still matches.
    expect(withinWorkspace("/home/x/file.ts", "/home/x")).toBe(true);
  });
});
