import { describe, it, expect } from "vitest";
import { parseJudgment, mergeCriteriaScores, lowestCriterion, focusDefects } from "./judgment";

describe("parseJudgment — new criteria-decomposed format", () => {
  it("computes the overall score as the mean of per-criterion scores ×10", () => {
    const j = parseJudgment('{"scores":{"c1":8,"c2":6},"defects":[]}');
    expect(j.score).toBe(70); // mean 7 × 10
    expect(j.criteriaScores).toEqual({ c1: 8, c2: 6 });
  });

  it("parses defects with criterion/issue/critical", () => {
    const j = parseJudgment(
      '{"scores":{"c1":9},"defects":[{"criterion":"c1","issue":"missing citation","critical":false}]}',
    );
    expect(j.criteriaDefects).toEqual([{ criterion: "c1", issue: "missing citation", critical: false }]);
    expect(j.defects).toEqual(["[c1] missing citation"]);
  });

  it("caps the OVERALL score at 50 when ANY defect is critical, even with many criteria", () => {
    // 6 criteria, one critical defect worth almost nothing to the mean —
    // the cap must still apply globally, not just to the offending criterion.
    const j = parseJudgment(
      '{"scores":{"c1":10,"c2":10,"c3":10,"c4":10,"c5":10,"c6":2},' +
        '"defects":[{"criterion":"c6","issue":"invented a version number","critical":true}]}',
    );
    expect(j.score).toBeLessThanOrEqual(50);
  });

  it("does not cap the score when no defect is critical", () => {
    const j = parseJudgment('{"scores":{"c1":9,"c2":9},"defects":[{"criterion":"c1","issue":"minor","critical":false}]}');
    expect(j.score).toBe(90);
  });

  it("clamps individual criterion scores to 0-10", () => {
    const j = parseJudgment('{"scores":{"c1":15,"c2":-3}}');
    expect(j.criteriaScores).toEqual({ c1: 10, c2: 0 });
  });

  it("accepts a bare-string defect (no criterion/critical) inside the new format", () => {
    const j = parseJudgment('{"scores":{"c1":5},"defects":["just a string"]}');
    expect(j.criteriaDefects).toEqual([{ criterion: "", issue: "just a string", critical: false }]);
  });
});

describe("parseJudgment — old single-score format (backward compatible)", () => {
  it("parses the old {score, defects} shape unchanged", () => {
    const j = parseJudgment('{"score":72,"defects":["issue one","issue two"]}');
    expect(j.score).toBe(72);
    expect(j.defects).toEqual(["issue one", "issue two"]);
    expect(j.criteriaScores).toBeUndefined();
  });

  it("clamps an out-of-range old-format score to 0-100", () => {
    expect(parseJudgment('{"score":150,"defects":[]}').score).toBe(100);
  });
});

describe("parseJudgment — malformed/unparseable input", () => {
  it("falls back to a heuristic score extraction when JSON parsing fails", () => {
    const j = parseJudgment("score: 90, looks good");
    expect(j.score).toBe(90);
    expect(j.defects).toEqual([]);
  });

  it("treats completely unparseable text as a low score with the raw text as the defect", () => {
    const j = parseJudgment("the model rambled without any score or JSON");
    expect(j.score).toBeLessThan(85);
    expect(j.defects.length).toBe(1);
  });

  it("does not throw on empty input", () => {
    expect(() => parseJudgment("")).not.toThrow();
  });

  it("falls back gracefully when `scores` is present but empty", () => {
    const j = parseJudgment('{"scores":{},"score":40,"defects":["x"]}');
    // no usable per-criterion values → old-format branch via `score`
    expect(j.score).toBe(40);
    expect(j.criteriaScores).toBeUndefined();
  });
});

describe("mergeCriteriaScores", () => {
  it("returns undefined when no judgment has a per-criterion breakdown", () => {
    expect(mergeCriteriaScores([{ score: 70, defects: [] }])).toBeUndefined();
  });

  it("merges by taking the MIN per criterion across judge samples", () => {
    const merged = mergeCriteriaScores([
      { score: 80, defects: [], criteriaScores: { c1: 8, c2: 6 } },
      { score: 70, defects: [], criteriaScores: { c1: 5, c2: 9 } },
    ]);
    expect(merged).toEqual({ c1: 5, c2: 6 });
  });
});

describe("lowestCriterion", () => {
  it("picks the criterion with the lowest score", () => {
    expect(lowestCriterion({ c1: 8, c2: 3, c3: 9 })).toBe("c2");
  });
  it("returns null for an empty map", () => {
    expect(lowestCriterion({})).toBeNull();
  });
});

describe("focusDefects", () => {
  it("narrows to only the lowest-scoring criterion's defects", () => {
    const judgments = [
      {
        score: 60,
        defects: ["[c1] a", "[c2] b"],
        criteriaScores: { c1: 8, c2: 2 },
        criteriaDefects: [
          { criterion: "c1", issue: "a", critical: false },
          { criterion: "c2", issue: "b", critical: false },
        ],
      },
    ];
    const focused = focusDefects(judgments, ["[c1] a", "[c2] b"]);
    expect(focused).toEqual(["b"]);
  });

  it("falls back to all defects when there is no per-criterion breakdown (old format)", () => {
    const judgments = [{ score: 60, defects: ["x", "y"] }];
    expect(focusDefects(judgments, ["x", "y"])).toEqual(["x", "y"]);
  });

  it("falls back to all defects when the lowest criterion has no defect entries attached", () => {
    const judgments = [
      {
        score: 70,
        defects: ["[c1] a"],
        criteriaScores: { c1: 8, c2: 2 }, // c2 is lowest but has no defect entry
        criteriaDefects: [{ criterion: "c1", issue: "a", critical: false }],
      },
    ];
    expect(focusDefects(judgments, ["[c1] a"])).toEqual(["[c1] a"]);
  });

  it("dedups identical issues across multiple judge samples for the same criterion", () => {
    const judgments = [
      {
        score: 60,
        defects: [],
        criteriaScores: { c1: 3 },
        criteriaDefects: [{ criterion: "c1", issue: "same issue", critical: false }],
      },
      {
        score: 60,
        defects: [],
        criteriaScores: { c1: 3 },
        criteriaDefects: [{ criterion: "c1", issue: "same issue", critical: false }],
      },
    ];
    expect(focusDefects(judgments, ["same issue"])).toEqual(["same issue"]);
  });
});
