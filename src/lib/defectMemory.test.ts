import { describe, it, expect, beforeEach } from "vitest";
import {
  normalizeDefect,
  recordInto,
  topFrom,
  formatDefectReminder,
  recordDefects,
  defectReminder,
  defectMemorySize,
  clearDefectMemory,
  MAX_ENTRIES,
  type DefectStore,
} from "./defectMemory";

// Minimal in-memory localStorage for the wrapper round-trip test (node env).
function installLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

describe("normalizeDefect", () => {
  it("clusters findings differing only in numbers/quotes/paths", () => {
    const a = normalizeDefect("無根拠な数値『5回』が evidence に存在しない");
    const b = normalizeDefect("無根拠な数値『12回』が evidence に存在しない");
    expect(a).toBe(b);
    expect(a).not.toBe("");
  });

  it("clusters findings differing only in a file path", () => {
    const a = normalizeDefect("src/main.rs を参照しているが evidence にない");
    const b = normalizeDefect("src/lib/agent.ts を参照しているが evidence にない");
    expect(a).toBe(b);
  });

  it("keeps genuinely different defects distinct", () => {
    expect(normalizeDefect("audience drift: wrote for seniors not juniors")).not.toBe(
      normalizeDefect("invented a library name absent from the evidence"),
    );
  });

  it("does not treat English apostrophes as quote spans (no span deletion)", () => {
    // With ' in the quote class, everything between the two apostrophes would be
    // deleted and these two distinct defects would falsely merge.
    const a = normalizeDefect("the draft doesn't address caching and the user's goal");
    const b = normalizeDefect("the draft doesn't address routing and the user's goal");
    expect(a).not.toBe(b);
    expect(a).toContain("caching");
  });

  it("returns empty for too-short strings", () => {
    expect(normalizeDefect("no")).toBe("");
    expect(normalizeDefect("  x  ")).toBe("");
  });
});

describe("recordInto", () => {
  it("increments counts for recurring normalized patterns", () => {
    let s: DefectStore = {};
    s = recordInto(s, ["invented number 5 not in evidence"], 1);
    s = recordInto(s, ["invented number 99 not in evidence"], 2);
    const vals = Object.values(s);
    expect(vals).toHaveLength(1);
    expect(vals[0].count).toBe(2);
    expect(vals[0].text).toBe("invented number 99 not in evidence"); // most recent representative
    expect(vals[0].ts).toBe(2);
  });

  it("skips defects that normalize to empty", () => {
    expect(Object.keys(recordInto({}, ["no", ""], 1))).toHaveLength(0);
  });

  it("evicts lowest-count patterns beyond MAX_ENTRIES (eviction must actually fire)", () => {
    // Letters-only suffixes: digits normalize to '#', which would collapse
    // every entry into ONE key and never trigger eviction (the original
    // version of this test passed without exercising the eviction path).
    const suffix = (i: number) =>
      String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26)) + "xxx";
    let s: DefectStore = {};
    // A high-count pattern recorded early (oldest ts) must survive on count.
    s = recordInto(s, ["surviving frequent defect pattern"], 1);
    s = recordInto(s, ["surviving frequent defect pattern"], 2);
    s = recordInto(s, ["surviving frequent defect pattern"], 3);
    // Fill past the cap with genuinely distinct one-off patterns.
    for (let i = 0; i < MAX_ENTRIES + 20; i++) {
      s = recordInto(s, [`distinct throwaway defect pattern ${suffix(i)}`], 100 + i);
    }
    // Precondition: the fill really produced distinct keys (guards against the
    // normalization collapsing them and making this test vacuous again).
    const size = Object.keys(s).length;
    expect(size).toBe(MAX_ENTRIES); // cap enforced…
    // …and eviction actually fired: 1 survivor + (MAX+20) one-offs > MAX.
    const oneOffs = Object.values(s).filter((r) => r.count === 1).length;
    expect(oneOffs).toBe(MAX_ENTRIES - 1); // some one-offs were dropped
    const survivor = Object.values(s).find((r) => r.text === "surviving frequent defect pattern");
    expect(survivor).toBeTruthy();
    expect(survivor!.count).toBe(3);
  });
});

describe("topFrom", () => {
  const store: DefectStore = {
    a: { count: 5, text: "frequent A", ts: 10 },
    b: { count: 1, text: "one-off B", ts: 20 },
    c: { count: 3, text: "recurring C", ts: 30 },
  };

  it("returns only recurring patterns (count >= minCount), most frequent first", () => {
    const top = topFrom(store, 3);
    expect(top.map((r) => r.text)).toEqual(["frequent A", "recurring C"]);
    expect(top.every((r) => r.count >= 2)).toBe(true);
  });

  it("respects n", () => {
    expect(topFrom(store, 1)).toHaveLength(1);
    expect(topFrom(store, 1)[0].text).toBe("frequent A");
  });
});

describe("formatDefectReminder", () => {
  it("is empty when there is nothing recurring", () => {
    expect(formatDefectReminder([])).toBe("");
  });

  it("renders a bulleted avoid-list", () => {
    const out = formatDefectReminder([{ count: 3, text: "invented a number", ts: 1 }]);
    expect(out).toContain("避けること");
    expect(out).toContain("- invented a number");
  });
});

describe("localStorage-backed wrappers (record → reminder → clear round-trip)", () => {
  beforeEach(() => installLocalStorage());

  it("only injects a pattern after it recurs across runs (minCount=2)", () => {
    recordDefects(["invented a specific count not present in the evidence"]); // run 1
    expect(defectReminder()).toBe(""); // seen once → not yet injected
    recordDefects(["invented a specific count not present in the evidence"]); // run 2
    const reminder = defectReminder();
    expect(reminder).toContain("避けること");
    expect(reminder).toContain("invented a specific count");
  });

  it("tracks size and clears", () => {
    recordDefects(["defect pattern alpha here", "defect pattern beta here"]);
    expect(defectMemorySize()).toBe(2);
    clearDefectMemory();
    expect(defectMemorySize()).toBe(0);
    expect(defectReminder()).toBe("");
  });
});
