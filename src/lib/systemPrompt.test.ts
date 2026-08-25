import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./systemPrompt";

const PLATFORM = { os: "linux", shell: "sh" };

function contentOf(...args: Parameters<typeof buildSystemPrompt>): string {
  return buildSystemPrompt(...args).content ?? "";
}

describe("buildSystemPrompt — global vs project instructions", () => {
  it("includes neither block when both rules are empty", () => {
    const c = contentOf("a.ts", null, null, "", "balanced", false, PLATFORM, "");
    expect(c).not.toContain("Global instructions");
    expect(c).not.toContain("Project-specific instructions");
  });

  it("includes only the global block when only globalRules is set", () => {
    const c = contentOf("a.ts", null, null, "", "balanced", false, PLATFORM, "always answer in Japanese");
    expect(c).toContain("Global instructions (from ~/.lokicode/rules, apply across all projects) — follow these:");
    expect(c).toContain("always answer in Japanese");
    expect(c).not.toContain("Project-specific instructions");
  });

  it("includes only the project block when only rules is set (globalRules omitted)", () => {
    const c = contentOf("a.ts", null, null, "use tabs, not spaces", "balanced", false, PLATFORM);
    expect(c).toContain("Project-specific instructions (from .lokicode/rules) — follow these:");
    expect(c).toContain("use tabs, not spaces");
    expect(c).not.toContain("Global instructions");
    // No global block present, so the "in addition to" cross-reference must not appear.
    expect(c).not.toContain("in addition to the global instructions above");
  });

  it("includes both blocks, global before project, with a conflict-priority note", () => {
    const c = contentOf(
      "a.ts",
      null,
      null,
      "use tabs, not spaces",
      "balanced",
      false,
      PLATFORM,
      "always answer in Japanese",
    );
    expect(c).toContain("always answer in Japanese");
    expect(c).toContain("use tabs, not spaces");
    expect(c.indexOf("Global instructions")).toBeLessThan(c.indexOf("Project-specific instructions"));
    expect(c).toContain("in addition to the global instructions above, and prefer these where the two conflict");
  });

  it("trims whitespace-only rules the same as empty rules", () => {
    const c = contentOf("a.ts", null, null, "   \n  ", "balanced", false, PLATFORM, "  \n ");
    expect(c).not.toContain("Global instructions");
    expect(c).not.toContain("Project-specific instructions");
  });
});
