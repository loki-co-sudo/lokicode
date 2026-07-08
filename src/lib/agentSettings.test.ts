import { describe, it, expect } from "vitest";
import {
  EFFORT_PARAMS,
  EFFORT_AGENT_GUIDANCE,
  DEFAULT_EFFORT,
  getEffort,
  getTerminalShell,
  setTerminalShell,
  type EffortLevel,
} from "./agentSettings";

const LEVELS: EffortLevel[] = ["speed", "balanced", "quality"];

describe("effort presets", () => {
  it("defines params and agent guidance for every level", () => {
    for (const l of LEVELS) {
      expect(EFFORT_PARAMS[l]).toBeDefined();
      expect(EFFORT_AGENT_GUIDANCE[l].length).toBeGreaterThan(10);
    }
  });

  it("scales monotonically from speed to quality (more compute = higher bars)", () => {
    const [s, b, q] = LEVELS.map((l) => EFFORT_PARAMS[l]);
    expect(s.passScore).toBeLessThan(b.passScore);
    expect(b.passScore).toBeLessThan(q.passScore);
    expect(s.escalateBelow).toBeLessThan(b.escalateBelow);
    expect(b.escalateBelow).toBeLessThan(q.escalateBelow);
    expect(s.ensembleSamples).toBeLessThanOrEqual(b.ensembleSamples);
    expect(b.ensembleSamples).toBeLessThanOrEqual(q.ensembleSamples);
    expect(s.sufficiencyRounds).toBeLessThanOrEqual(b.sufficiencyRounds);
    expect(b.sufficiencyRounds).toBeLessThanOrEqual(q.sufficiencyRounds);
    expect(s.judgeSamples).toBeLessThanOrEqual(b.judgeSamples);
    expect(b.judgeSamples).toBeLessThanOrEqual(q.judgeSamples);
    expect(s.phaseIterations).toBeLessThan(b.phaseIterations);
    expect(b.phaseIterations).toBeLessThan(q.phaseIterations);
  });

  it("multi-sample judge is a quality-tier-only spend (adaptive compute)", () => {
    expect(EFFORT_PARAMS.speed.judgeSamples).toBe(1);
    expect(EFFORT_PARAMS.balanced.judgeSamples).toBe(1);
    expect(EFFORT_PARAMS.quality.judgeSamples).toBe(2);
  });

  it("speed disables the ensemble (width 1)", () => {
    expect(EFFORT_PARAMS.speed.ensembleSamples).toBe(1);
  });

  it("keeps escalateBelow under passScore so escalation can trigger before pass", () => {
    for (const l of LEVELS) {
      expect(EFFORT_PARAMS[l].escalateBelow).toBeLessThan(EFFORT_PARAMS[l].passScore);
    }
  });

  it("falls back to the balanced default without localStorage (node env)", () => {
    expect(getEffort()).toBe(DEFAULT_EFFORT);
    expect(DEFAULT_EFFORT).toBe("balanced");
  });
});

// Minimal in-memory localStorage for the round-trip test (node env has none).
function installLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

describe("terminal shell preference", () => {
  it("defaults to empty (auto = previous fixed behavior) without localStorage", () => {
    expect(getTerminalShell()).toBe("");
  });

  it("round-trips through localStorage", () => {
    installLocalStorage();
    setTerminalShell("pwsh");
    expect(getTerminalShell()).toBe("pwsh");
    setTerminalShell("");
    expect(getTerminalShell()).toBe("");
  });
});
