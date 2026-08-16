import { describe, it, expect } from "vitest";
import { extractCitations, validateCitations } from "./citations";

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
