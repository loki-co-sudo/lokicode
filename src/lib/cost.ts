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
  try {
    localStorage.setItem(CALIB_KEY, JSON.stringify(c));
  } catch {
    // storage full / unavailable — calibration is best-effort, never fatal
  }
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
  // Negative price = variable/router model (e.g. openrouter/fusion): cost is
  // not knowable up front, so report "unknown" rather than a misleading figure.
  if (t.promptPrice < 0 || t.completionPrice < 0 || s.promptPrice < 0 || s.completionPrice < 0)
    return { usd: 0, calls: 0, ok: false, calibrated: calib.samples > 0 };

  const thinkOut = calib.outTokens;
  const synthOut = Math.round(calib.outTokens * SYNTH_PREMIUM);
  const breadth = Math.max(1, Math.min(5, Math.floor(p.samples))); // investigation angles
  const depth = Math.max(0, p.depth); // verify/refine rounds
  const mult = p.useTools ? calib.toolMult : 1;

  // Structural call counts of the orchestrated pipeline (see lib/reasoning.ts):
  //   [classify(cheap, tools only)] → brief(strong) → investigate ×b + sufficiency
  //   (cheap, b>1) → draft(cheap) → judge ×D + refine ×D (cheap) → final(strong).
  // On non-trivial tasks (ensemble) the draft and final become Mixture-of-Agents:
  //   draft = N proposers + 1 merge (cheap, plain);
  //   final = N candidates + 1 select (strong, plain).
  const ensemble = breadth > 1 || depth >= 3;
  const N = 2; // ENSEMBLE_SAMPLES

  const classifyCalls = p.useTools ? 1 : 0; // NEEDS_EXEC gate, cheap plain
  const briefCalls = 1; // strong, short
  const investCalls = breadth > 1 ? breadth : 0; // cheap, tool loop
  const suffCalls = breadth > 1 ? 1 : 0; // cheap, plain
  const judgeCalls = depth; // STRONG, plain (strong verifier)
  const refineCalls = depth; // cheap, tool loop (early-stop often fewer)
  const draftLoop = ensemble ? 0 : 1; // single draft is a tool loop
  const draftPlain = ensemble ? N + 1 : 0; // proposers + merge (plain)
  const finalLoop = ensemble ? 0 : 1; // single final is a strong tool loop
  const finalPlain = ensemble ? N + 1 : 0; // candidates + select (strong, plain)

  // Guard against negative / non-finite prices (e.g. a "-1" variable-price
  // sentinel) so the estimate can never go absurdly negative.
  const px = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  const inTok = p.promptTokens + INSTR;
  const thinkPer = inTok * px(t.promptPrice) + thinkOut * px(t.completionPrice);
  const synthPer = inTok * px(s.promptPrice) + synthOut * px(s.completionPrice);

  // Agent-loop phases carry the tool multiplier; plain completions do not.
  const cheapLoop = investCalls + refineCalls + draftLoop;
  const cheapPlain = classifyCalls + suffCalls + draftPlain;
  const strongLoop = finalLoop;
  const strongPlain = briefCalls + finalPlain + judgeCalls; // judge runs on the strong model
  const usd =
    strongPlain * synthPer +
    strongLoop * synthPer * mult +
    cheapLoop * thinkPer * mult +
    cheapPlain * thinkPer;

  const baseCalls =
    classifyCalls + briefCalls + investCalls + suffCalls + judgeCalls + refineCalls + draftLoop + draftPlain + finalLoop + finalPlain;
  const calls = p.useTools
    ? Math.round((cheapLoop + strongLoop) * mult + cheapPlain + strongPlain)
    : baseCalls;
  return { usd, calls, ok: true, calibrated: calib.samples > 0 };
}
