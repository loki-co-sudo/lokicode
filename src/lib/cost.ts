// Pre-send cost estimate for deep-reasoning (recurrent-depth) runs.
// Still an approximation, but tuned for accuracy by (a) CJK-aware token counting
// and (b) calibration from real usage recorded after each run (learned average
// output size and tool-loop call multiplier).

export interface ModelPrice {
  /** USD per input token. */
  promptPrice: number;
  /** USD per output token. */
  completionPrice: number;
}

const INSTR = 80; // per-call instruction/prompt overhead (tokens)
const SYNTH_PREMIUM = 1.3; // synthesis output tends to be longer than thinking

const DEFAULT_OUT = 700; // fallback avg output tokens/call before any calibration
const DEFAULT_TOOL_MULT = 2.5;

/** CJK-aware token estimate: CJK chars ≈ ~1 token, other text ≈ 4 chars/token. */
export function approxTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    const isCjk =
      (c >= 0x3000 && c <= 0x9fff) || // Kana, CJK ideographs
      (c >= 0xac00 && c <= 0xd7a3) || // Hangul
      (c >= 0xff00 && c <= 0xffef) || // full-width forms
      (c >= 0x20000 && c <= 0x2ffff); // CJK ext.
    if (isCjk) cjk++;
    else other++;
  }
  return Math.ceil(cjk * 0.9 + other / 4);
}

// ── Calibration: learn from observed usage so estimates improve over time ──

interface Calib {
  /** Learned average completion (output) tokens per API call. */
  outTokens: number;
  /** Learned multiplier of actual calls vs structural calls when tools are on. */
  toolMult: number;
  /** How many calls have contributed to the calibration. */
  samples: number;
}

const CALIB_KEY = "lokicode.costCalib";

export function loadCalib(): Calib {
  try {
    const c = JSON.parse(localStorage.getItem(CALIB_KEY) ?? "");
    return {
      outTokens: Number(c.outTokens) > 0 ? Number(c.outTokens) : DEFAULT_OUT,
      toolMult: Number(c.toolMult) > 0 ? Number(c.toolMult) : DEFAULT_TOOL_MULT,
      samples: Number(c.samples) || 0,
    };
  } catch {
    return { outTokens: DEFAULT_OUT, toolMult: DEFAULT_TOOL_MULT, samples: 0 };
  }
}

function save(c: Calib) {
  localStorage.setItem(CALIB_KEY, JSON.stringify(c));
}

/** Fold an observed per-call completion-token count into the running average. */
export function recordCompletion(tokens: number) {
  if (!tokens || tokens <= 0) return;
  const c = loadCalib();
  const a = 0.15; // EWMA weight
  c.outTokens = Math.round(c.outTokens * (1 - a) + tokens * a);
  c.samples += 1;
  save(c);
}

/** Fold an observed tool run's call count (vs structural) into the multiplier. */
export function recordToolRun(actualCalls: number, structuralCalls: number) {
  if (structuralCalls <= 0 || actualCalls <= 0) return;
  const c = loadCalib();
  const ratio = Math.max(1, actualCalls / structuralCalls);
  const a = 0.25;
  c.toolMult = Math.round((c.toolMult * (1 - a) + ratio * a) * 100) / 100;
  save(c);
}

export interface CostEstimate {
  usd: number;
  /** Estimated number of API calls. */
  calls: number;
  /** False when a selected model's pricing is unknown (id not in the list). */
  ok: boolean;
  /** True once real usage has calibrated the estimate. */
  calibrated: boolean;
}

export interface EstimateParams {
  promptTokens: number;
  depth: number;
  samples: number;
  useTools: boolean;
  thinking?: ModelPrice;
  synthesis?: ModelPrice;
  /** Calibration (defaults applied when omitted). */
  calib?: Calib;
}

export function estimateDeepReasoningCost(p: EstimateParams): CostEstimate {
  const t = p.thinking;
  const s = p.synthesis;
  const calib = p.calib ?? loadCalib();
  if (!t || !s) return { usd: 0, calls: 0, ok: false, calibrated: calib.samples > 0 };

  const thinkOut = calib.outTokens;
  const synthOut = Math.round(calib.outTokens * SYNTH_PREMIUM);
  const breadth = Math.max(1, Math.min(5, Math.floor(p.samples))); // investigation angles
  const depth = Math.max(0, p.depth); // verify/refine rounds
  const mult = p.useTools ? calib.toolMult : 1;

  // Structural call counts of the orchestrated pipeline (see lib/reasoning.ts):
  //   brief(strong) → investigate ×b + sufficiency (cheap, b>1)
  //   → draft(cheap) → judge ×D + refine ×D (cheap, refine may escalate)
  //   → final(strong). Only brief and final use the strong model now.
  const briefCalls = 1; // strong, short
  const investCalls = breadth > 1 ? breadth : 0; // cheap, tool loop
  const suffCalls = breadth > 1 ? 1 : 0; // cheap, plain
  const draftCalls = 1; // cheap, tool loop
  const judgeCalls = depth; // cheap, plain
  const refineCalls = depth; // cheap, tool loop (early-stop often fewer)
  const finalCalls = 1; // strong, tool loop

  const inTok = p.promptTokens + INSTR;
  const thinkPer = inTok * t.promptPrice + thinkOut * t.completionPrice;
  const synthPer = inTok * s.promptPrice + synthOut * s.completionPrice;

  // Agent-loop phases (investigate/draft/refine/final) carry the tool multiplier;
  // plain completions (brief/sufficiency/judge) do not.
  const cheapLoop = investCalls + draftCalls + refineCalls;
  const cheapPlain = suffCalls + judgeCalls;
  const usd =
    briefCalls * synthPer +
    finalCalls * synthPer * mult +
    cheapLoop * thinkPer * mult +
    cheapPlain * thinkPer;

  const baseCalls =
    briefCalls + investCalls + suffCalls + draftCalls + judgeCalls + refineCalls + finalCalls;
  const calls = p.useTools
    ? Math.round((cheapLoop + finalCalls) * mult + cheapPlain + briefCalls)
    : baseCalls;
  return { usd, calls, ok: true, calibrated: calib.samples > 0 };
}
