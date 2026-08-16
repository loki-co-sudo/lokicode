import { describe, it, expect } from "vitest";
import { extractCitations, validateCitations, downgradeUnverifiedCitations } from "./citations";

describe("extractCitations", () => {
  it("extracts a relative path citation", () => {
    const cs = extractCitations("see src/lib/reasoning.ts:451 for the budget logic");
    expect(cs).toEqual([{ path: "src/lib/reasoning.ts", line: 451, quote: undefined }]);
  });

  it("extracts an absolute POSIX path citation", () => {
    const cs = extractCitations("defined at /home/loki/projects/lokicode/src/lib/agent.ts:120");
    expect(cs).toEqual([
      { path: "/home/loki/projects/lokicode/src/lib/agent.ts", line: 120, quote: undefined },
    ]);
  });

  it("extracts an absolute Windows path citation", () => {
    const cs = extractCitations(`C:\\repo\\src\\lib\\cost.ts:255 has the formula`);
    expect(cs).toEqual([{ path: "C:\\repo\\src\\lib\\cost.ts", line: 255, quote: undefined }]);
  });

  it("extracts a quoted excerpt with an em dash", () => {
    const cs = extractCitations(`- path/a.ts:10 — "const x = 1;" → establishes the default`);
    expect(cs).toEqual([{ path: "path/a.ts", line: 10, quote: "const x = 1;" }]);
  });

  it("extracts a quoted excerpt with an arrow separator", () => {
    const cs = extractCitations(`path/a.ts:10 -> "const x = 1;"`);
    expect(cs[0].quote).toBe("const x = 1;");
  });

  it("dedups by path:line, keeping the first quote seen", () => {
    const cs = extractCitations(`a.ts:1 — "first"\n... a.ts:1 mentioned again without quote`);
    expect(cs).toHaveLength(1);
    expect(cs[0].quote).toBe("first");
  });

  it("returns [] for text with no citations", () => {
    expect(extractCitations("no citations here, just prose.")).toEqual([]);
  });

  it("ignores a zero or negative line number", () => {
    expect(extractCitations("weird a.ts:0 citation")).toEqual([]);
  });
});

describe("validateCitations", () => {
  const fileA = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
  const files: Record<string, string> = {
    "a.ts": fileA,
    "b.ts": `function foo() {\n  return 42;\n}\n`,
  };
  const reader = async (p: string) => files[p] ?? null;

  it("passes citations whose path exists and line is in range", async () => {
    const r = await validateCitations([{ path: "a.ts", line: 5 }], reader);
    expect(r).toEqual({ ok: true, invalid: [] });
  });

  it("flags a nonexistent path as not-found", async () => {
    const r = await validateCitations([{ path: "missing.ts", line: 1 }], reader);
    expect(r.ok).toBe(false);
    expect(r.invalid).toEqual([{ path: "missing.ts", line: 1, reason: "not-found" }]);
  });

  it("flags a line number past the end of the file", async () => {
    const r = await validateCitations([{ path: "a.ts", line: 999 }], reader);
    expect(r.ok).toBe(false);
    expect(r.invalid).toEqual([{ path: "a.ts", line: 999, reason: "line-out-of-range" }]);
  });

  it("passes a quoted citation whose excerpt matches the cited line", async () => {
    const r = await validateCitations([{ path: "b.ts", line: 2, quote: "return 42;" }], reader);
    expect(r).toEqual({ ok: true, invalid: [] });
  });

  it("tolerates the excerpt landing one line off (±1 window)", async () => {
    const r = await validateCitations([{ path: "b.ts", line: 1, quote: "return 42;" }], reader);
    expect(r).toEqual({ ok: true, invalid: [] });
  });

  it("flags a quoted citation whose excerpt is nowhere near the cited line", async () => {
    const r = await validateCitations([{ path: "b.ts", line: 1, quote: "totally different" }], reader);
    expect(r.ok).toBe(false);
    expect(r.invalid).toEqual([{ path: "b.ts", line: 1, reason: "quote-mismatch" }]);
  });

  it("does NOT treat a citation with no quote as a mismatch (stage 1 only)", async () => {
    const r = await validateCitations([{ path: "a.ts", line: 1 }], reader);
    expect(r).toEqual({ ok: true, invalid: [] });
  });

  it("validates multiple citations independently and collects all invalid ones", async () => {
    const r = await validateCitations(
      [
        { path: "a.ts", line: 1 },
        { path: "missing.ts", line: 1 },
        { path: "a.ts", line: 999 },
      ],
      reader,
    );
    expect(r.ok).toBe(false);
    expect(r.invalid).toHaveLength(2);
  });
});

describe("downgradeUnverifiedCitations", () => {
  const goodText = [
    "VERIFIED:",
    '- a.ts:1 — "real line" → this fact is grounded',
    '- fake.ts:5 — "made up" → this fact is fabricated',
    "",
    "ASSUMPTIONS:",
    "- some existing assumption",
    "",
    "UNKNOWN:",
    "- none",
  ].join("\n");

  it("is a no-op when there are no invalid citations", () => {
    const r = downgradeUnverifiedCitations(goodText, new Set());
    expect(r).toEqual({ text: goodText, downgradedCount: 0 });
  });

  it("moves a VERIFIED line with an invalid citation into ASSUMPTIONS", () => {
    const r = downgradeUnverifiedCitations(goodText, new Set(["fake.ts:5"]));
    expect(r.downgradedCount).toBe(1);
    // the fabricated line is gone from the VERIFIED section specifically
    const verifiedBlock = r.text.split("ASSUMPTIONS:")[0];
    expect(verifiedBlock).not.toContain("fake.ts:5");
    // it now appears right after the ASSUMPTIONS header, marked as auto-downgraded
    expect(r.text).toMatch(/ASSUMPTIONS:\n- fake\.ts:5 — "made up" → this fact is fabricated 〔未検証の引用のため自動降格〕/);
    // the grounded VERIFIED line is untouched
    expect(r.text).toContain('- a.ts:1 — "real line" → this fact is grounded');
    // the pre-existing assumption survives
    expect(r.text).toContain("- some existing assumption");
  });

  it("downgrades multiple lines and preserves order relative to each other", () => {
    const text = [
      "VERIFIED:",
      "- a.ts:1 — good one",
      "- bad1.ts:1 — first fake",
      "- bad2.ts:1 — second fake",
      "ASSUMPTIONS:",
      "- none",
    ].join("\n");
    const r = downgradeUnverifiedCitations(text, new Set(["bad1.ts:1", "bad2.ts:1"]));
    expect(r.downgradedCount).toBe(2);
    const assumptionsBlock = r.text.split("ASSUMPTIONS:")[1];
    expect(assumptionsBlock.indexOf("bad1.ts:1")).toBeLessThan(assumptionsBlock.indexOf("bad2.ts:1"));
  });

  it("creates an ASSUMPTIONS section when the text has none", () => {
    const text = ["VERIFIED:", "- fake.ts:1 — bogus fact"].join("\n");
    const r = downgradeUnverifiedCitations(text, new Set(["fake.ts:1"]));
    expect(r.downgradedCount).toBe(1);
    expect(r.text).toContain("ASSUMPTIONS:");
    expect(r.text).toContain("fake.ts:1");
  });

  it("does not downgrade a VERIFIED line whose citation is valid, even when other citations are invalid elsewhere", () => {
    const r = downgradeUnverifiedCitations(goodText, new Set(["fake.ts:5"]));
    expect(r.text).toContain('- a.ts:1 — "real line" → this fact is grounded');
  });

  it("does not touch ASSUMPTIONS/UNKNOWN lines even if they contain a matching citation key", () => {
    const text = [
      "VERIFIED:",
      "- a.ts:1 — fine",
      "ASSUMPTIONS:",
      "- fake.ts:9 — already an assumption, not VERIFIED",
    ].join("\n");
    const before = text;
    const r = downgradeUnverifiedCitations(text, new Set(["fake.ts:9"]));
    expect(r.downgradedCount).toBe(0);
    expect(r.text).toBe(before);
  });
});
