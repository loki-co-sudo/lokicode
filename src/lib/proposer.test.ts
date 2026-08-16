import { describe, it, expect } from "vitest";
import { assignAngles, distillPastAttempts } from "./proposer";

describe("assignAngles", () => {
  it("returns n distinct instructions for typical ensemble widths", () => {
    for (const n of [2, 3]) {
      const angles = assignAngles(["応答は簡潔であること"], n);
      expect(angles).toHaveLength(n);
      expect(new Set(angles).size).toBe(n); // all distinct
    }
  });

  it("folds the top criterion into the angle text (references THIS brief, not generic)", () => {
    const angles = assignAngles(["ユーザーは初学者である"], 1);
    expect(angles[0]).toContain("ユーザーは初学者である");
  });

  it("falls back to a generic phrase when there are no criteria", () => {
    const angles = assignAngles([], 1);
    expect(angles[0]).toContain("最も重要な基準");
  });

  it("returns an empty array for n<=0", () => {
    expect(assignAngles(["x"], 0)).toEqual([]);
  });

  it("cycles the pool (with repeats) when n exceeds the template count", () => {
    const angles = assignAngles(["x"], 7);
    expect(angles).toHaveLength(7);
    expect(angles[0]).toBe(angles[5]); // pool length is 5 → wraps
  });
});

describe("distillPastAttempts", () => {
  it("returns empty string when there are no past rounds", () => {
    expect(distillPastAttempts([])).toBe("");
  });

  it("returns empty string when every past round had no defects", () => {
    expect(distillPastAttempts([[], []])).toBe("");
  });

  it("includes distinct defects from past rounds", () => {
    const text = distillPastAttempts([["defect A"], ["defect B"]]);
    expect(text).toContain("defect A");
    expect(text).toContain("defect B");
  });

  it("dedups a defect repeated across multiple rounds", () => {
    const text = distillPastAttempts([["defect A"], ["defect A", "defect B"]]);
    const occurrences = (text.match(/defect A/g) ?? []).length;
    expect(occurrences).toBe(1);
    expect(text).toContain("defect B");
  });

  it("frames the text as a record of a different attempt (misread-prevention wrapper)", () => {
    const text = distillPastAttempts([["defect A"]]);
    expect(text).toMatch(/別の記録|現在の事実として扱わない/);
  });
});
