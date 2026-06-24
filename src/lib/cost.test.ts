import { describe, it, expect } from "vitest";
import { approxTokens, estimateDeepReasoningCost } from "./cost";

const calib = { outTokens: 700, toolMult: 2.5, samples: 1 };

describe("approxTokens", () => {
  it("is 0 for empty", () => {
    expect(approxTokens("")).toBe(0);
  });
  it("counts ASCII at ~4 chars/token", () => {
    expect(approxTokens("hello world")).toBe(3); // ceil(11/4)
  });
  it("counts CJK at ~0.9/char", () => {
    expect(approxTokens("あいう")).toBe(3); // ceil(3*0.9)
  });
});

describe("estimateDeepReasoningCost", () => {
  const params = {
    promptTokens: 1000,
    depth: 3,
    samples: 3,
    useTools: true,
    calib,
  };

  it("reports unknown (ok:false) when model pricing is missing", () => {
    const r = estimateDeepReasoningCost({ ...params });
    expect(r.ok).toBe(false);
  });

  it("reports unknown when a price is negative (variable/router model)", () => {
    const r = estimateDeepReasoningCost({
      ...params,
      thinking: { promptPrice: -1, completionPrice: -1 },
      synthesis: { promptPrice: 0.000003, completionPrice: 0.000015 },
    });
    expect(r.ok).toBe(false);
  });

  it("estimates a positive cost with valid pricing", () => {
    const r = estimateDeepReasoningCost({
      ...params,
      thinking: { promptPrice: 0.0000001, completionPrice: 0.0000002 },
      synthesis: { promptPrice: 0.000003, completionPrice: 0.000015 },
    });
    expect(r.ok).toBe(true);
    expect(r.usd).toBeGreaterThan(0);
    expect(r.calls).toBeGreaterThan(0);
  });

  it("never returns a negative cost", () => {
    const r = estimateDeepReasoningCost({
      ...params,
      thinking: { promptPrice: 0.000001, completionPrice: 0.000001 },
      synthesis: { promptPrice: 0.00001, completionPrice: 0.00002 },
    });
    expect(r.usd).toBeGreaterThanOrEqual(0);
  });
});
