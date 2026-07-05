import { describe, it, expect } from "vitest";
import { parseNeedsExec, parseBrief } from "./reasoning";

describe("parseNeedsExec", () => {
  it("parses a clean one-word verdict", () => {
    expect(parseNeedsExec("YES")).toBe(true);
    expect(parseNeedsExec("no")).toBe(false);
    expect(parseNeedsExec("はい")).toBe(true);
    expect(parseNeedsExec("いいえ")).toBe(false);
  });

  it("takes the LAST verdict when the model rambles (e2e-observed failure)", () => {
    // A stray "yes" inside the reasoning must not flip an analysis question
    // onto the execute path.
    expect(
      parseNeedsExec(
        "Yes, the request mentions files, but it only asks to organize information. " +
          "Reading files is not a system change. Final answer: NO",
      ),
    ).toBe(false);
    expect(parseNeedsExec("It seems no changes at first, but a commit is required: YES")).toBe(
      true,
    );
  });

  it("defaults to NO (safe read-only analysis path) when unparseable", () => {
    expect(parseNeedsExec("")).toBe(false);
    expect(parseNeedsExec("わかりません")).toBe(false);
  });

  it("does not false-match inside words", () => {
    expect(parseNeedsExec("nothing to do here")).toBe(false); // "no" in "nothing" must not count
  });
});

describe("parseBrief SUBTASKS (P3 solve-level decomposition)", () => {
  const briefText = [
    "GOAL: build the feature end to end",
    "CRITERIA:",
    "- works",
    "- tested",
    "CONSTRAINTS: none",
    "SUBTASKS:",
    "S: implement the data layer",
    "S: implement the UI component",
    "S: wire them together",
    "QUESTIONS:",
    "Q: where does the data live?",
  ].join("\n");

  it("parses S: lines into subtasks without breaking the other sections", () => {
    const b = parseBrief(briefText, 3);
    expect(b.subtasks).toEqual([
      "implement the data layer",
      "implement the UI component",
      "wire them together",
    ]);
    expect(b.goal).toContain("build the feature");
    expect(b.criteria).toHaveLength(2);
    expect(b.constraints).toHaveLength(0); // 'none' filtered
    expect(b.questions).toEqual(["where does the data live?"]);
  });

  it("treats 'S: none' as indivisible (no decomposition)", () => {
    const b = parseBrief("GOAL: g\nSUBTASKS:\nS: none", 1);
    expect(b.subtasks).toEqual([]);
  });

  it("caps subtasks at 5", () => {
    const many = "SUBTASKS:\n" + Array.from({ length: 8 }, (_, i) => `S: part ${i + 1}`).join("\n");
    expect(parseBrief(many, 1).subtasks).toHaveLength(5);
  });

  it("returns empty subtasks when the section is absent (normal draft path)", () => {
    expect(parseBrief("GOAL: g\nCRITERIA:\n- c", 1).subtasks).toEqual([]);
  });
});
