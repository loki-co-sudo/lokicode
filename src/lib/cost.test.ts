import { describe, it, expect } from "vitest";
import {
  approxTokens,
  estimateDeepReasoningCost,
  pipelineShape,
  structuralCalls,
} from "./cost";

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

describe("pipelineShape", () => {
  it("simple run (depth 1, breadth 1, tools): no decomposition, no ensemble", () => {
    const s = pipelineShape(1, 1, true);
    expect(s).toEqual({
      classify: 1,
      brief: 1,
      invest: 0,
      suff: 0,
      judge: 1,
      refine: 1,
      draftLoop: 1, // single draft is a tool loop
      draftPlain: 0,
      finalLoop: 1, // single final is a tool loop
      finalPlain: 0,
    });
  });

  it("depth>=3 turns draft/final into Mixture-of-Agents (plain), no loop draft/final", () => {
    const s = pipelineShape(3, 1, true);
    expect(s.draftLoop).toBe(0);
    expect(s.finalLoop).toBe(0);
    expect(s.draftPlain).toBe(3); // N proposers + 1 merge (N=2)
    expect(s.finalPlain).toBe(3); // N candidates + 1 select
    expect(s.judge).toBe(3);
    expect(s.refine).toBe(3);
  });

  it("breadth>1 adds investigation + sufficiency and triggers ensemble", () => {
    const s = pipelineShape(1, 3, true);
    expect(s.invest).toBe(3);
    expect(s.suff).toBe(1);
    expect(s.draftLoop).toBe(0); // ensemble
    expect(s.finalPlain).toBe(3);
  });

  it("no-tools run drops the classify (NEEDS_EXEC) call", () => {
    expect(pipelineShape(1, 1, false).classify).toBe(0);
    expect(pipelineShape(1, 1, true).classify).toBe(1);
  });

  it("clamps breadth to 1..5 and floors depth at 0", () => {
    expect(pipelineShape(-5, 99, true).invest).toBe(5); // breadth capped at 5
    expect(pipelineShape(-5, 1, true).judge).toBe(0); // depth floored at 0
  });

  it("effort width 1 disables the ensemble even on deep runs", () => {
    const s = pipelineShape(3, 1, true, 1);
    expect(s.draftLoop).toBe(1);
    expect(s.draftPlain).toBe(0);
    expect(s.finalLoop).toBe(1);
    expect(s.finalPlain).toBe(0);
    expect(s.invest).toBe(0); // no ensemble → no grounding investigation needed
  });

  it("effort width 3 widens the MoA draft/final to 4 calls each", () => {
    const s = pipelineShape(3, 1, true, 3);
    expect(s.draftPlain).toBe(4); // 3 proposers + 1 merge
    expect(s.finalPlain).toBe(4); // 3 candidates + 1 select
  });

  it("multiplies judge calls by judgeSamples (quality effort), refine unchanged", () => {
    const s = pipelineShape(3, 1, true, 2, 2);
    expect(s.judge).toBe(6); // depth 3 × 2 parallel judges
    expect(s.refine).toBe(3);
    expect(pipelineShape(3, 1, true, 2, 1).judge).toBe(3);
  });

  it("adds one grounding investigation on ensemble runs with breadth 1 + tools", () => {
    expect(pipelineShape(3, 1, true).invest).toBe(1); // ensemble, no breadth → ground once
    expect(pipelineShape(3, 1, false).invest).toBe(0); // no tools → cannot investigate
    expect(pipelineShape(1, 1, true).invest).toBe(0); // no ensemble → tool-using draft grounds itself
    expect(pipelineShape(3, 3, true).invest).toBe(3); // breadth already investigates
  });
});

describe("structuralCalls", () => {
  it("loop = invest+refine+draftLoop+finalLoop, plain = the rest", () => {
    // depth 1, breadth 1, tools: loop = 0+1+1+1 = 3; plain = 1+1+0+1+0+0 = 3
    expect(structuralCalls(1, 1, true)).toEqual({ loop: 3, plain: 3 });
  });

  it("matches the per-phase shape exactly (single source of truth)", () => {
    const s = pipelineShape(3, 3, true);
    const c = structuralCalls(3, 3, true);
    expect(c.loop).toBe(s.invest + s.refine + s.draftLoop + s.finalLoop);
    expect(c.plain).toBe(s.classify + s.brief + s.suff + s.judge + s.draftPlain + s.finalPlain);
  });
});
