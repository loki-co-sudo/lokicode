import { describe, it, expect, beforeEach } from "vitest";
import {
  hashContent,
  taskKeyFor,
  extractCitedPaths,
  extractVerifiedFacts,
  recordFactsInto,
  validFacts,
  formatCachedFacts,
  buildCachedFactsMessage,
  recordVerifiedFacts,
  evidenceCacheSize,
  clearEvidenceCache,
  MAX_FACTS_PER_TASK,
  MAX_TASKS,
  type EvidenceStore,
  type CachedFact,
} from "./evidenceCache";

function installLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

describe("hashContent", () => {
  it("is stable and change-sensitive", () => {
    expect(hashContent("abc")).toBe(hashContent("abc"));
    expect(hashContent("abc")).not.toBe(hashContent("abd"));
  });
});

describe("taskKeyFor", () => {
  it("ignores whitespace/case differences in the question", () => {
    expect(taskKeyFor("Explain the  verify PHASE")).toBe(taskKeyFor("explain the verify phase"));
    expect(taskKeyFor("a")).not.toBe(taskKeyFor("b"));
  });
});

describe("extractCitedPaths", () => {
  it("extracts relative, absolute and wrapped citations", () => {
    expect(extractCitedPaths("見た `src/lib/agent.ts:433` を確認")).toContain("src/lib/agent.ts");
    expect(extractCitedPaths("C:\\Users\\x\\proj\\src\\a.ts:5 にある")).toContain(
      "C:\\Users\\x\\proj\\src\\a.ts",
    );
    expect(extractCitedPaths("(agent.ts:12)")).toContain("agent.ts");
  });

  it("extracts an absolute POSIX path (macOS/Linux)", () => {
    expect(extractCitedPaths("見た `/Users/x/proj/src/a.ts:12` を確認")).toContain(
      "/Users/x/proj/src/a.ts",
    );
  });

  it("returns nothing when there is no citation", () => {
    expect(extractCitedPaths("no citation here, just prose")).toEqual([]);
  });
});

describe("extractVerifiedFacts", () => {
  const inv = [
    "VERIFIED:",
    "- passScore はエフォートで決まる (src/lib/agentSettings.ts:20)",
    "- judge は強モデルで走る (src/lib/reasoning.ts:857)",
    "- 引用のない主張はここに書く",
    "ASSUMPTIONS:",
    "- これは仮定 (src/lib/x.ts:1)",
    "UNKNOWN:",
    "- none",
  ].join("\n");

  it("keeps only VERIFIED bullets that carry a citation", () => {
    const facts = extractVerifiedFacts(inv);
    expect(facts).toHaveLength(2);
    expect(facts[0].paths).toEqual(["src/lib/agentSettings.ts"]);
    expect(facts.every((f) => f.paths.length > 0)).toBe(true);
  });

  it("excludes ASSUMPTIONS/UNKNOWN even when they cite files", () => {
    const facts = extractVerifiedFacts(inv);
    expect(facts.some((f) => f.fact.includes("仮定"))).toBe(false);
  });

  it("scans MULTIPLE VERIFIED sections (joined evidence) and dedups", () => {
    const joined = [
      "### 調査: q1",
      "VERIFIED:",
      "- fact one (a.ts:1)",
      "ASSUMPTIONS:",
      "- none",
      "### 調査: q2",
      "VERIFIED:",
      "- fact two (b.ts:2)",
      "- fact one (a.ts:1)", // duplicate across findings → deduped
      "UNKNOWN:",
      "- none",
    ].join("\n");
    const facts = extractVerifiedFacts(joined);
    expect(facts.map((f) => f.fact)).toEqual(["fact one (a.ts:1)", "fact two (b.ts:2)"]);
  });
});

describe("validFacts — the hash-invalidation safety property", () => {
  const facts: CachedFact[] = [
    { fact: "fact A", files: [{ path: "a.ts", hash: "111" }], ts: 1 },
    { fact: "fact B (two files)", files: [{ path: "b.ts", hash: "222" }, { path: "c.ts", hash: "333" }], ts: 2 },
  ];

  it("keeps a fact only when EVERY cited file's hash still matches", () => {
    const ok = validFacts(facts, new Map([["a.ts", "111"], ["b.ts", "222"], ["c.ts", "333"]]));
    expect(ok.map((f) => f.fact)).toEqual(["fact A", "fact B (two files)"]);
  });

  it("DROPS a fact when a cited file changed (core safety)", () => {
    const changed = validFacts(facts, new Map([["a.ts", "999"], ["b.ts", "222"], ["c.ts", "333"]]));
    expect(changed.map((f) => f.fact)).toEqual(["fact B (two files)"]);
  });

  it("DROPS a multi-file fact if ANY one file changed", () => {
    const partial = validFacts(facts, new Map([["a.ts", "111"], ["b.ts", "222"], ["c.ts", "CHANGED"]]));
    expect(partial.map((f) => f.fact)).toEqual(["fact A"]);
  });

  it("DROPS a fact whose cited file is now unreadable (null)", () => {
    const gone = validFacts(facts, new Map([["a.ts", null], ["b.ts", "222"], ["c.ts", "333"]]));
    expect(gone.map((f) => f.fact)).toEqual(["fact B (two files)"]);
  });
});

describe("recordFactsInto", () => {
  it("stores facts with the current hash of each readable cited file", () => {
    const s = recordFactsInto({}, "task1", [{ fact: "f1", paths: ["a.ts"] }], new Map([["a.ts", "h1"]]), 10);
    expect(s.task1[0]).toEqual({ fact: "f1", files: [{ path: "a.ts", hash: "h1" }], ts: 10 });
  });

  it("skips facts whose cited files were all unreadable", () => {
    const s = recordFactsInto({}, "task1", [{ fact: "f1", paths: ["a.ts"] }], new Map(), 10);
    expect(s.task1 ?? []).toHaveLength(0);
  });

  it("caps facts per task (most recent kept)", () => {
    let s: EvidenceStore = {};
    for (let i = 0; i < MAX_FACTS_PER_TASK + 15; i++) {
      s = recordFactsInto(s, "t", [{ fact: `fact ${i}`, paths: ["a.ts"] }], new Map([["a.ts", "h"]]), i);
    }
    expect(s.t.length).toBe(MAX_FACTS_PER_TASK);
    // Newest survive (eviction actually fired: total recorded > cap).
    expect(s.t.some((f) => f.fact === `fact ${MAX_FACTS_PER_TASK + 14}`)).toBe(true);
    expect(s.t.some((f) => f.fact === "fact 0")).toBe(false);
  });

  it("caps the number of tasks (LRU by newest fact)", () => {
    let s: EvidenceStore = {};
    for (let i = 0; i < MAX_TASKS + 5; i++) {
      s = recordFactsInto(s, `task${i}`, [{ fact: "f", paths: ["a.ts"] }], new Map([["a.ts", "h"]]), i);
    }
    expect(Object.keys(s).length).toBe(MAX_TASKS);
    expect(s.task0).toBeUndefined(); // oldest evicted
  });
});

describe("formatCachedFacts", () => {
  it("is empty for no facts", () => {
    expect(formatCachedFacts([])).toBe("");
  });
  it("frames the facts as a re-confirmed starting point", () => {
    const out = formatCachedFacts([{ fact: "X (a.ts:1)", files: [{ path: "a.ts", hash: "h" }], ts: 1 }]);
    expect(out).toContain("ハッシュ一致");
    expect(out).toContain("再確認");
    expect(out).toContain("- X (a.ts:1)");
  });
});

describe("async wrappers (record → validate round-trip through a mock reader)", () => {
  beforeEach(() => installLocalStorage());

  it("re-injects a fact next run when the file is unchanged, drops it when changed", async () => {
    const files: Record<string, string> = { "src/a.ts": "content-v1" };
    const read = async (p: string) => files[p] ?? null;
    const inv = "VERIFIED:\n- alpha is configured here (src/a.ts:3)\nASSUMPTIONS:\n- none";
    const key = taskKeyFor("how is alpha configured?");

    await recordVerifiedFacts(key, [inv], read);
    // Unchanged file → fact re-injected.
    let msg = await buildCachedFactsMessage(key, read);
    expect(msg).toContain("alpha is configured here");

    // File changes → hash mismatch → fact must NOT be injected.
    files["src/a.ts"] = "content-v2-edited";
    msg = await buildCachedFactsMessage(key, read);
    expect(msg).toBe("");
  });

  it("does not leak facts across different tasks", async () => {
    const read = async () => "same";
    await recordVerifiedFacts(taskKeyFor("question one"), ["VERIFIED:\n- one (a.ts:1)"], read);
    const other = await buildCachedFactsMessage(taskKeyFor("question two"), read);
    expect(other).toBe("");
  });

  it("tracks size and clears", async () => {
    const read = async () => "x";
    await recordVerifiedFacts(taskKeyFor("q"), ["VERIFIED:\n- a (a.ts:1)\n- b (b.ts:2)"], read);
    expect(evidenceCacheSize()).toBe(2);
    clearEvidenceCache();
    expect(evidenceCacheSize()).toBe(0);
  });
});
