import { describe, it, expect } from "vitest";
import { parseFinding, compactEvidence } from "./evidence";

describe("parseFinding", () => {
  it("extracts all four sections from a well-formed finding", () => {
    const text = [
      "### 調査: どこで検証するか",
      "VERIFIED:",
      '- a.ts:1 — "x" → fact one',
      '- a.ts:2 — "y" → fact two',
      "ASSUMPTIONS:",
      "- maybe true",
      "UNKNOWN:",
      "- unclear thing",
    ].join("\n");
    const p = parseFinding(text);
    expect(p.title).toBe("### 調査: どこで検証するか");
    expect(p.verified).toEqual(['a.ts:1 — "x" → fact one', 'a.ts:2 — "y" → fact two']);
    expect(p.assumptions).toEqual(["maybe true"]);
    expect(p.unknown).toEqual(["unclear thing"]);
    expect(p.freeform).toEqual([]);
  });

  it("treats 'none' as a literal UNKNOWN/ASSUMPTIONS bullet, not empty (caller's concern)", () => {
    const text = ["### 調査: q", "VERIFIED:", "- fact", "ASSUMPTIONS:", "- none", "UNKNOWN:", "- none"].join(
      "\n",
    );
    const p = parseFinding(text);
    expect(p.assumptions).toEqual(["none"]);
    expect(p.unknown).toEqual(["none"]);
  });

  it("captures unstructured content with no headers at all as freeform, preserving line breaks", () => {
    const text = "### 調査: q\nこれはただの文章です。\n複数行にわたります。";
    const p = parseFinding(text);
    expect(p.title).toBe("### 調査: q");
    expect(p.verified).toEqual([]);
    expect(p.freeform).toEqual(["これはただの文章です。\n複数行にわたります。"]);
  });

  it("handles a finding with only VERIFIED (no ASSUMPTIONS/UNKNOWN sections)", () => {
    const p = parseFinding("### 調査: q\nVERIFIED:\n- only fact");
    expect(p.verified).toEqual(["only fact"]);
    expect(p.assumptions).toEqual([]);
    expect(p.unknown).toEqual([]);
  });
});

describe("compactEvidence", () => {
  function finding(q: string, verifiedLines: string[], assumptions: string[] = [], unknown: string[] = []) {
    return [
      `### 調査: ${q}`,
      "VERIFIED:",
      ...verifiedLines.map((l) => `- ${l}`),
      "ASSUMPTIONS:",
      ...(assumptions.length ? assumptions.map((a) => `- ${a}`) : ["- none"]),
      "UNKNOWN:",
      ...(unknown.length ? unknown.map((u) => `- ${u}`) : ["- none"]),
    ].join("\n");
  }

  it("keeps everything when the budget is generous, with no eviction", () => {
    const findings = [finding("q1", ["a.ts:1 — fact1"], ["assume1"], ["gap1"])];
    const r = compactEvidence(findings, 5000);
    expect(r.evictedVerified).toBe(0);
    expect(r.text).toContain("a.ts:1 — fact1");
    expect(r.text).toContain("assume1");
    expect(r.text).toContain("UNKNOWN: 1件");
  });

  it("dedups a VERIFIED fact (same citation) repeated across findings, keeping only the first", () => {
    const findings = [
      finding("q1", ["a.ts:1 — fact one"]),
      finding("q2", ["a.ts:1 — fact one restated"]), // same path:line → same key
    ];
    const r = compactEvidence(findings, 5000);
    const occurrences = (r.text.match(/a\.ts:1/g) ?? []).length;
    expect(occurrences).toBe(1);
    expect(r.evictedVerified).toBe(0); // a dup is dropped, not "evicted"
  });

  it("does NOT collapse distinct citations that merely share a line number across different files", () => {
    const findings = [
      finding("q1", Array.from({ length: 5 }, (_, i) => `file${i}.ts:1 — fact${i}`)),
    ];
    const r = compactEvidence(findings, 5000);
    for (let i = 0; i < 5; i++) expect(r.text).toContain(`file${i}.ts:1`);
  });

  it("evicts VERIFIED lines under a tight budget and reports the eviction count (assert it fired)", () => {
    const longFacts = Array.from({ length: 20 }, (_, i) => `file${i}.ts:${i + 1} — ${"x".repeat(80)}`);
    const findings = [finding("q1", longFacts)];
    const r = compactEvidence(findings, 500); // budget forces some evictions
    expect(r.evictedVerified).toBeGreaterThan(0);
    expect(r.text).toContain(`〔予算のため VERIFIED ${r.evictedVerified}件を省略〕`);
  });

  it("keeps VERIFIED lines whole — never truncates a citation mid-string", () => {
    const longFacts = Array.from({ length: 20 }, (_, i) => `file${i}.ts:${i + 1} — ${"x".repeat(80)}`);
    const findings = [finding("q1", longFacts)];
    const r = compactEvidence(findings, 500);
    for (const line of r.text.split("\n")) {
      if (line.startsWith("- file")) {
        // a kept line must contain its full citation, not a cut-off fragment
        expect(line).toMatch(/^- file\d+\.ts:\d+ — x+$/);
      }
    }
  });

  it("always shows the UNKNOWN headline count even when the budget is essentially exhausted by VERIFIED", () => {
    const longFacts = [`a.ts:1 — ${"x".repeat(2000)}`];
    const findings = [finding("q1", longFacts, [], ["gap1", "gap2"])];
    const r = compactEvidence(findings, 100); // budget << the single VERIFIED line
    expect(r.evictedVerified).toBe(1);
    expect(r.text).toContain("UNKNOWN: 2件");
  });

  it("drops ASSUMPTIONS before ever touching VERIFIED when budget is tight (priority order)", () => {
    const findings = [finding("q1", ["a.ts:1 — important fact"], ["a".repeat(2000)])];
    const r = compactEvidence(findings, 60); // fits the VERIFIED line, not the assumption
    expect(r.text).toContain("important fact");
    expect(r.text).not.toContain("a".repeat(2000));
  });

  it("preserves freeform (unstructured) content when there is budget for it", () => {
    const findings = ["### 調査: q1\nこれは自由記述です。"];
    const r = compactEvidence(findings, 5000);
    expect(r.text).toContain("これは自由記述です。");
  });

  it("does not count a literal 'none'/'なし' UNKNOWN placeholder toward the headline", () => {
    const findings = [finding("q1", ["a.ts:1 — fact"])]; // unknown defaults to "- none"
    const r = compactEvidence(findings, 5000);
    expect(r.text).not.toMatch(/UNKNOWN: \d+件/);
  });

  it("does not keep a literal 'none' ASSUMPTIONS placeholder in the output", () => {
    const findings = [finding("q1", ["a.ts:1 — fact"])]; // assumptions defaults to "- none"
    const r = compactEvidence(findings, 5000);
    expect(r.text).not.toContain("ASSUMPTIONS:");
  });

  it("is a pure function: identical input yields identical output", () => {
    const findings = [finding("q1", ["a.ts:1 — f1"], ["assume1"], ["gap1"])];
    const r1 = compactEvidence(findings, 500);
    const r2 = compactEvidence(findings, 500);
    expect(r1).toEqual(r2);
  });
});
