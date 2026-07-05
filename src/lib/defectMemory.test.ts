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

  it("evicts lowest-count patterns beyond MAX_ENTRIES", () => {
    let s: DefectStore = {};
    // Fill past the cap with distinct one-off patterns...
    for (let i = 0; i < MAX_ENTRIES + 10; i++) s = recordInto(s, [`distinct defect pattern number alpha ${i}`], i);
    expect(Object.keys(s).length).toBeLessThanOrEqual(MAX_ENTRIES);
    // A high-count pattern must survive eviction.
    s = recordInto(s, ["surviving frequent defect pattern"], 1000);
    s = recordInto(s, ["surviving frequent defect pattern here"], 1001); // different (has 'here')
    s = recordInto(s, ["surviving frequent defect pattern"], 1002);
    for (let i = 0; i < 50; i++) s = recordInto(s, [`another throwaway defect ${i}`], 2000 + i);
    const survivor = Object.values(s).find((r) => r.text.startsWith("surviving frequent defect pattern") && r.count >= 2);
    expect(survivor).toBeTruthy();
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
