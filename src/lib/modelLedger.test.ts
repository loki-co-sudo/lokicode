import { describe, it, expect } from "vitest";
import {
  recordRunInto,
  scorePerDollar,
  bestModel,
  MIN_RUNS_TO_TRUST,
  type ModelLedger,
} from "./modelLedger";

describe("recordRunInto", () => {
  it("seeds on first run, EWMA-updates after", () => {
    let l: ModelLedger = {};
    l = recordRunInto(l, "m", 80, 0.01);
    expect(l.m).toEqual({ runs: 1, avgScore: 80, avgCost: 0.01 });
    l = recordRunInto(l, "m", 90, 0.02, 0.5);
    expect(l.m.runs).toBe(2);
    expect(l.m.avgScore).toBeCloseTo(85, 5);
    expect(l.m.avgCost).toBeCloseTo(0.015, 5);
  });

  it("tracks models independently", () => {
    let l: ModelLedger = {};
    l = recordRunInto(l, "a", 70, 0.1);
    l = recordRunInto(l, "b", 60, 0.2);
    expect(Object.keys(l).sort()).toEqual(["a", "b"]);
  });
});

describe("scorePerDollar", () => {
  it("ranks a free/cheap model above a pricey one at equal score", () => {
    expect(scorePerDollar({ runs: 5, avgScore: 80, avgCost: 0 })).toBeGreaterThan(
      scorePerDollar({ runs: 5, avgScore: 80, avgCost: 0.05 }),
    );
  });
});

describe("bestModel (ε-greedy — implemented, not yet wired)", () => {
  const ledger: ModelLedger = {
    cheapGood: { runs: MIN_RUNS_TO_TRUST, avgScore: 82, avgCost: 0.002 },
    priceyGood: { runs: MIN_RUNS_TO_TRUST, avgScore: 88, avgCost: 0.05 },
    untrusted: { runs: 1, avgScore: 99, avgCost: 0.001 },
  };

  it("exploits the best score-per-dollar among TRUSTED models", () => {
    // rand()=0.9 → no explore; picks by value. cheapGood: 82/0.002=41000 wins.
    const pick = bestModel(ledger, ["cheapGood", "priceyGood"], 0.1, () => 0.9);
    expect(pick).toBe("cheapGood");
  });

  it("ignores models without enough runs (returns null → keep user's choice)", () => {
    expect(bestModel(ledger, ["untrusted"], 0.1, () => 0.9)).toBeNull();
  });

  it("explores a random candidate with probability epsilon", () => {
    // rand()=0.05 < epsilon → explore; second rand()=0 → index 0.
    const seq = [0.05, 0];
    let i = 0;
    const pick = bestModel(ledger, ["cheapGood", "priceyGood"], 0.1, () => seq[i++]);
    expect(pick).toBe("cheapGood");
  });

  it("returns null for no candidates", () => {
    expect(bestModel(ledger, [], 0.1, () => 0.9)).toBeNull();
  });
});
