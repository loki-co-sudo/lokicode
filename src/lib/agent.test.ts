import { describe, it, expect, afterEach } from "vitest";
import {
  commandRisk,
  toolNeedsApproval,
  withinWorkspace,
  initPathCaseSensitivity,
  advertisedTools,
  CONSULT_ADVISOR_TOOL,
  ASK_USER_TOOL,
} from "./agent";

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

describe("advertisedTools (advisor-mode.md §1 経路B: consult_advisor advertisement)", () => {
  it("omits both ask_user and consult_advisor by default", () => {
    const tools = advertisedTools({}, false);
    expect(tools).not.toContain(ASK_USER_TOOL);
    expect(tools).not.toContain(CONSULT_ADVISOR_TOOL);
  });

  it("advertises consult_advisor only when advisorModel is set", () => {
    expect(advertisedTools({ advisorModel: "openai/gpt-5" }, false)).toContain(CONSULT_ADVISOR_TOOL);
    expect(advertisedTools({}, false)).not.toContain(CONSULT_ADVISOR_TOOL);
  });

  it("advertises consult_advisor even in read-only phases (not gated on readOnly)", () => {
    expect(advertisedTools({ readOnly: true, advisorModel: "openai/gpt-5" }, false)).toContain(
      CONSULT_ADVISOR_TOOL,
    );
  });

  it("ask_user and consult_advisor are gated independently of each other", () => {
    // advisorModel set but no askUser callback / allowAskUser: only consult_advisor shows up.
    const onlyAdvisor = advertisedTools({ advisorModel: "openai/gpt-5" }, false);
    expect(onlyAdvisor).toContain(CONSULT_ADVISOR_TOOL);
    expect(onlyAdvisor).not.toContain(ASK_USER_TOOL);

    // allowAskUser + callback present but no advisorModel: only ask_user shows up.
    const onlyAskUser = advertisedTools({ allowAskUser: true }, true);
    expect(onlyAskUser).toContain(ASK_USER_TOOL);
    expect(onlyAskUser).not.toContain(CONSULT_ADVISOR_TOOL);
  });

  it("allowAskUser without an askUser callback does not advertise ask_user", () => {
    expect(advertisedTools({ allowAskUser: true }, false)).not.toContain(ASK_USER_TOOL);
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
