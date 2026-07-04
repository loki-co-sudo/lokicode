import { describe, it, expect } from "vitest";
import { assessDeepThinkReadiness } from "./modelGate";
import type { ModelInfo } from "./openrouter";

function m(over: Partial<ModelInfo>): ModelInfo {
  return {
    id: "test/model",
    name: "Test",
    promptPrice: 0.000001,
    completionPrice: 0.000002,
    contextLength: 128000,
    supportsTools: true,
    intelligenceIndex: 50,
    codingIndex: null,
    ...over,
  } as ModelInfo;
}

describe("assessDeepThinkReadiness", () => {
  it("is ok with a smart tool-capable synthesis and a decent thinking model", () => {
    const models = [
      m({ id: "google/gemini-2.5-pro", intelligenceIndex: 60 }),
      m({ id: "deepseek/deepseek-chat", intelligenceIndex: 40 }),
    ];
    const r = assessDeepThinkReadiness("deepseek/deepseek-chat", "google/gemini-2.5-pro", models);
    expect(r.level).toBe("ok");
    expect(r.issues).toEqual([]);
  });

  it("flags a router synthesis model as critical (verifier identity unknown)", () => {
    const r = assessDeepThinkReadiness("deepseek/deepseek-chat", "openrouter/free", []);
    expect(r.level).toBe("critical");
    expect(r.issues[0].target).toBe("synthesis");
  });

  it("flags synthesis intelligence below 35 as critical, 35-44 as warn", () => {
    const low = [m({ id: "small/8b", intelligenceIndex: 22 })];
    expect(assessDeepThinkReadiness("", "small/8b", low).level).toBe("critical");
    const mid = [m({ id: "mid/model", intelligenceIndex: 40 })];
    expect(assessDeepThinkReadiness("", "mid/model", mid).level).toBe("warn");
    const good = [m({ id: "good/model", intelligenceIndex: 45 })];
    expect(assessDeepThinkReadiness("", "good/model", good).level).toBe("ok");
  });

  it("flags variable-priced synthesis as critical", () => {
    const models = [m({ id: "meta/variable", promptPrice: -1, completionPrice: -1 })];
    expect(assessDeepThinkReadiness("", "meta/variable", models).level).toBe("critical");
  });

  it("flags a non-tool thinking model as critical (cannot ground the investigation)", () => {
    const models = [
      m({ id: "good/synth", intelligenceIndex: 60 }),
      m({ id: "npt/think", supportsTools: false }),
    ];
    const r = assessDeepThinkReadiness("npt/think", "good/synth", models);
    expect(r.level).toBe("critical");
    expect(r.issues[0].target).toBe("thinking");
  });

  it("warns (not critical) for the free router as thinking model", () => {
    const models = [m({ id: "good/synth", intelligenceIndex: 60 })];
    const r = assessDeepThinkReadiness("openrouter/free", "good/synth", models);
    expect(r.level).toBe("warn");
  });

  it("stays silent for unknown ids and null intelligence (cannot judge)", () => {
    expect(assessDeepThinkReadiness("unknown/x", "unknown/y", []).level).toBe("ok");
    const noIdx = [m({ id: "no/index", intelligenceIndex: null })];
    expect(assessDeepThinkReadiness("", "no/index", noIdx).level).toBe("ok");
  });
});
