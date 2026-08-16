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
  /** Effort preset's ensemble width (defaults to the balanced preset's 2). */
  ensembleSamples?: number;
  /** Effort preset's parallel judge samples (defaults to 1). */
  judgeSamples?: number;
  /** Solve-level decomposition expected (P3). */
  decompose?: boolean;
  /** Defect-guided beam expected (P6: deep-hard × quality). */
  beam?: boolean;
}

/** Per-phase structural call counts of the orchestrated pipeline
 * (see lib/reasoning.ts):
 *   [classify(cheap, tools only)] → brief(strong) → investigate ×b + sufficiency
 *   (cheap, b>1) → draft(cheap) → judge ×D + refine ×D (cheap) → final(strong).
 * On non-trivial tasks (ensemble) the draft and final become Mixture-of-Agents:
 *   draft = N proposers + 1 merge (cheap, plain); final = N candidates + 1 select.
 * This is the SINGLE source of truth shared by the cost estimate and the live
 * tool-multiplier calibration, so the two can never drift apart. "loop" phases
 * run as tool-using agent mini-loops (and so inflate by the learned toolMult);
 * every other phase is one plain completion. */
export interface PipelineShape {
  classify: number;
  brief: number;
  invest: number;
  suff: number;
  judge: number;
  refine: number;
  draftLoop: number;
  draftPlain: number;
  finalLoop: number;
  finalPlain: number;
  /** Solve-level decomposition (P3): sub-task solves (cheap tool loops). The
   * count is data-dependent at runtime (the brief decides); the shape assumes
   * the median width 3 when `decompose` is passed. */
  subtask: number;
  /** The strong-model composition of the sub-task solutions. */
  compose: number;
  /** Defect-guided beam (P6): parallel refine candidates (strong tool loops).
   * Fires at most once per run and only on deep-hard×quality; the shape counts
   * it when `beam` is passed. */
  beamBranch: number;
  /** The strong-model judges that score the beam candidates. */
  beamJudge: number;
  /** Execution fast-path (deepthink-v3-roadmap P10): the executor's own
   * tool-using agent loop, counted as ONE structural call (like `invest`/
   * `refine`) — its internal round-trips inflate via `toolMult` at estimate
   * time exactly like every other loop phase. 0 on the analysis path. */
  execute: number;
  /** The optional post-execution grounded review (strong, plain — a single
   * CRITERIA/CONSTRAINTS check against the diff). 0 unless it actually ran. */
  execReview: number;
  /** Advisor auto-consult (advisor-mode.md §1 経路A): one plain completion to
   * the (separately-configured) advisor model, fired at most once per run when
   * the execute phase's verify loop hits stuck-detection. 0 unless it actually
   * fired. Only meaningful when `execute` is 1 — Agent mode's own verify loop
   * also supports advisor auto-consult but is outside this deep-reasoning cost
   * model entirely (it has no pipelineShape of its own). */
  advisorConsult: number;
}

// Counts normal-path calls only; the empty-output retry in reasoning.ts
// `think()` is an abnormal-path fallback and is intentionally not modeled here.
export function pipelineShape(
  depth: number,
  samples: number,
  useTools: boolean,
  /** Effort preset's MoA / best-of-N width (1 disables the ensemble). */
  ensembleSamples = 2,
  /** Effort preset's parallel judge samples per verify round. */
  judgeSamples = 1,
  /** Solve-level decomposition happened/expected (P3): sub-task solves replace
   * the MoA draft. Runtime width is data-dependent; the shape assumes 3. */
  decompose = false,
  /** Defect-guided beam expected (P6): adds BEAM_WIDTH refine branches + their
   * judges (fires at most once per run on deep-hard×quality). */
  beam = false,
  /** Execution fast-path happened/expected (P10). IMPORTANT ASYMMETRY (see
   * `estimateDeepReasoningCost`'s doc comment): the PRE-SEND estimate must
   * never pass this (the route isn't decided until after send — always shows
   * the analysis-path shape as a safe upper bound), but POST-RUN calibration
   * (`structuralCalls` → `cost.ts` callers' `recordToolRun`) should pass the
   * run's actual `needsExec` once it's known, or the tool multiplier gets
   * learned against a shape the run never actually had. */
  execPath = false,
  /** The optional grounded review (P10 §3) actually ran this run. Only
   * meaningful when `execPath` is true. */
  execReview = false,
  /** Advisor auto-consult (advisor-mode.md §1) actually fired this run. Same
   * asymmetry rule as `execPath`/`execReview`: the PRE-SEND estimate must
   * never pass this (stuck-detection is data-dependent and unknowable before
   * the run), only POST-RUN calibration passes the run's actual outcome. Only
   * meaningful when `execPath` is true. */
  advisorConsult = false,
): PipelineShape {
  const breadth = Math.max(1, Math.min(5, Math.floor(samples)));
  const d = Math.max(0, Math.floor(depth));
  const N = Math.max(1, Math.floor(ensembleSamples));
  const J = Math.max(1, Math.floor(judgeSamples));
  const ensemble = N > 1 && (breadth > 1 || d >= 3);
  // Minimum grounding: an ensemble run with no investigation drafts tool-less,
  // so reasoning.ts inserts one read-only investigation of the GOAL first.
  const grounding = useTools && ensemble && breadth === 1 ? 1 : 0;
  const K = 3; // assumed median sub-task width when decomposed
  const BW = 2; // BEAM_WIDTH (mirrors reasoning.ts)
  // classify ∥ brief always run up front (they decide the route) regardless
  // of which path is taken — only the phases AFTER the route decision differ.
  const classify = useTools ? 1 : 0;
  if (execPath) {
    return {
      classify,
      brief: 1,
      invest: 0,
      suff: 0,
      judge: 0,
      refine: 0,
      draftLoop: 0,
      draftPlain: 0,
      finalLoop: 0,
      finalPlain: 0,
      subtask: 0,
      compose: 0,
      beamBranch: 0,
      beamJudge: 0,
      execute: 1,
      execReview: execReview ? 1 : 0,
      advisorConsult: advisorConsult ? 1 : 0,
    };
  }
  return {
    classify,
    brief: 1,
    invest: breadth > 1 ? breadth : grounding,
    suff: breadth > 1 ? 1 : 0,
    judge: d * J,
    refine: d,
    draftLoop: decompose ? 0 : ensemble ? 0 : 1,
    draftPlain: decompose ? 0 : ensemble ? N + 1 : 0,
    finalLoop: ensemble ? 0 : 1,
    finalPlain: ensemble ? N + 1 : 0,
    subtask: decompose ? K : 0,
    compose: decompose ? 1 : 0,
    beamBranch: beam ? BW : 0,
    beamJudge: beam ? BW : 0,
    execute: 0,
    execReview: 0,
    advisorConsult: 0,
  };
}

/** Agent-loop vs plain structural call totals — the calibration divides observed
 * loop round-trips by `loop` to learn the tool multiplier, exactly the count the
 * estimate multiplies by it. `execPath`/`execReview`/`advisorConsult` (P10 /
 * advisor-mode.md §1): pass the run's ACTUAL route once known — this is the
 * post-run calibration caller, not the pre-send estimate, so unlike
 * `estimateDeepReasoningCost` it is correct (and necessary) to pass them here.
 * See `pipelineShape`'s `execPath` doc comment. */
export function structuralCalls(
  depth: number,
  samples: number,
  useTools: boolean,
  ensembleSamples = 2,
  judgeSamples = 1,
  decompose = false,
  beam = false,
  execPath = false,
  execReview = false,
  advisorConsult = false,
): { loop: number; plain: number } {
  const s = pipelineShape(
    depth,
    samples,
    useTools,
    ensembleSamples,
    judgeSamples,
    decompose,
    beam,
    execPath,
    execReview,
    advisorConsult,
  );
  return {
    loop: s.invest + s.refine + s.draftLoop + s.finalLoop + s.subtask + s.beamBranch + s.execute,
    plain:
      s.classify +
      s.brief +
      s.suff +
      s.judge +
      s.draftPlain +
      s.finalPlain +
      s.compose +
      s.beamJudge +
      s.execReview +
      s.advisorConsult,
  };
}

// PRE-SEND estimate (P10): intentionally NEVER passes execPath to
// pipelineShape — at send time neither the router's classification nor the
// deep-think NEEDS_EXEC verdict has run yet, so whether a run will take the
// execute fast path is genuinely unknown. Always showing the (larger)
// analysis-path shape keeps this a safe upper bound rather than a guess that
// can under-estimate. The execute-path shape is only used for POST-RUN
// calibration (`structuralCalls`, called after the route is known) — see its
// doc comment.
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
  const mult = p.useTools ? calib.toolMult : 1;
  const sh = pipelineShape(
    p.depth,
    p.samples,
    p.useTools,
    p.ensembleSamples ?? 2,
    p.judgeSamples ?? 1,
    p.decompose ?? false,
    p.beam ?? false,
  );

  // Guard against negative / non-finite prices (e.g. a "-1" variable-price
  // sentinel) so the estimate can never go absurdly negative.
  const px = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  const inTok = p.promptTokens + INSTR;
  const thinkPer = inTok * px(t.promptPrice) + thinkOut * px(t.completionPrice);
  const synthPer = inTok * px(s.promptPrice) + synthOut * px(s.completionPrice);

  // Agent-loop phases carry the tool multiplier; plain completions do not.
  const cheapLoop = sh.invest + sh.refine + sh.draftLoop + sh.subtask;
  const cheapPlain = sh.classify + sh.suff + sh.draftPlain;
  // Beam branches are strong-model tool loops; beam judges are strong plain.
  const strongLoop = sh.finalLoop + sh.beamBranch;
  const strongPlain = sh.brief + sh.finalPlain + sh.judge + sh.compose + sh.beamJudge; // strong model
  const usd =
    strongPlain * synthPer +
    strongLoop * synthPer * mult +
    cheapLoop * thinkPer * mult +
    cheapPlain * thinkPer;

  const baseCalls = cheapLoop + cheapPlain + strongLoop + strongPlain;
  const calls = p.useTools
    ? Math.round((cheapLoop + strongLoop) * mult + cheapPlain + strongPlain)
    : baseCalls;
  return { usd, calls, ok: true, calibrated: calib.samples > 0 };
}
