// Rough pre-send cost estimate for deep-reasoning (recurrent-depth) runs.
// Everything here is an approximation — token counts and per-phase output sizes
// are heuristics, so the result is labelled 概算 in the UI.

export interface ModelPrice {
  /** USD per input token. */
  promptPrice: number;
  /** USD per output token. */
  completionPrice: number;
}

// Heuristic average output sizes per phase (tokens).
const THINK_OUT = 700; // draft / reflection
const SYNTH_OUT = 1000; // aggregation / final synthesis
const INSTR = 80; // reflect/synthesis instruction overhead
const NUDGE = 30; // draft nudge overhead
const TOOL_MULT = 2.5; // tool loops add extra round-trips (very rough)

/** Very rough token estimate from character length (mixed JP/EN ≈ 3.5 chars/token). */
export function approxTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 3.5);
}

export interface CostEstimate {
  usd: number;
  /** Estimated number of API calls. */
  calls: number;
  /** False when a selected model's pricing is unknown (id not in the list). */
  ok: boolean;
}

export interface EstimateParams {
  /** Approximate input tokens of the base prompt (system + history + file + input). */
  promptTokens: number;
  depth: number;
  samples: number;
  useTools: boolean;
  /** Resolved prices (undefined when the model id isn't in the fetched list). */
  thinking?: ModelPrice;
  synthesis?: ModelPrice;
}

export function estimateDeepReasoningCost(p: EstimateParams): CostEstimate {
  const t = p.thinking;
  const s = p.synthesis;
  if (!t || !s) return { usd: 0, calls: 0, ok: false };

  const n = p.useTools ? 1 : Math.max(1, p.samples); // tools disable parallel sampling
  const depth = Math.max(0, p.depth);

  const draftIn = p.promptTokens + NUDGE;
  const reflectIn = p.promptTokens + THINK_OUT + INSTR;

  // Thinking-model phases: drafts + reflections.
  let thinkCost =
    n * (draftIn * t.promptPrice + THINK_OUT * t.completionPrice) +
    depth * (reflectIn * t.promptPrice + THINK_OUT * t.completionPrice);
  if (p.useTools) thinkCost *= TOOL_MULT;

  // Synthesis-model phases: optional aggregation (when sampling) + final synthesis.
  const aggIn = p.promptTokens + n * THINK_OUT;
  const synthIn = p.promptTokens + THINK_OUT + INSTR;
  const synthCost =
    (n > 1 ? aggIn * s.promptPrice + SYNTH_OUT * s.completionPrice : 0) +
    (synthIn * s.promptPrice + SYNTH_OUT * s.completionPrice);

  const calls = n + depth + (n > 1 ? 1 : 0) + 1;
  return { usd: thinkCost + synthCost, calls, ok: true };
}
