// Model performance ledger (frontier-roadmap P7 — infrastructure phase).
//
// Records the quality (final judge score) and cost of each deep-think run,
// keyed by the thinking model, building the "score × cost" ledger a bandit
// selector needs. RECORDING is live so data accumulates from now on. The
// ε-greedy SELECTION (`bestModel`) is implemented and unit-tested but is NOT
// yet wired to override the user's model choice — per the spec it activates
// only once the ledger holds enough runs per model ("台帳が溜まるまで着手しない").

const KEY = "lokicode.modelLedger";
/** Per-model runs required before the exploit arm trusts a model's stats. */
export const MIN_RUNS_TO_TRUST = 5;
/** Cost floor (USD) so free models don't divide by zero when ranking value. */
const COST_FLOOR = 0.0005;

export interface LedgerEntry {
  runs: number;
  /** EWMA of the final judge score (0–100). */
  avgScore: number;
  /** EWMA of the run cost (USD). */
  avgCost: number;
}

export type ModelLedger = Record<string, LedgerEntry>;

/** Fold one observed run into the ledger (pure, EWMA). */
export function recordRunInto(
  ledger: ModelLedger,
  model: string,
  score: number,
  cost: number,
  alpha = 0.3,
): ModelLedger {
  const prev = ledger[model];
  const entry: LedgerEntry = prev
    ? {
        runs: prev.runs + 1,
        avgScore: prev.avgScore * (1 - alpha) + score * alpha,
        avgCost: prev.avgCost * (1 - alpha) + cost * alpha,
      }
    : { runs: 1, avgScore: score, avgCost: cost };
  return { ...ledger, [model]: entry };
}

/** Value metric: judge score per dollar (free models rank high when they score
 * well, via the cost floor). Pure. */
export function scorePerDollar(e: LedgerEntry): number {
  return e.avgScore / Math.max(e.avgCost, COST_FLOOR);
}

/**
 * ε-greedy pick among `candidates` (pure; `rand`/`pick` injected for testing).
 * Explore with probability `epsilon` (a random candidate); otherwise exploit
 * the trusted model with the best score-per-dollar. Returns null when no
 * candidate has enough runs to trust — the caller then keeps the user's choice.
 * NOTE: not yet wired to actually select a model (P7 is deferred).
 */
export function bestModel(
  ledger: ModelLedger,
  candidates: string[],
  epsilon = 0.1,
  rand: () => number = Math.random,
): string | null {
  if (candidates.length === 0) return null;
  if (rand() < epsilon) return candidates[Math.floor(rand() * candidates.length)];
  const trusted = candidates
    .map((m) => ({ m, e: ledger[m] }))
    .filter((x): x is { m: string; e: LedgerEntry } => !!x.e && x.e.runs >= MIN_RUNS_TO_TRUST);
  if (trusted.length === 0) return null;
  return trusted.sort((a, b) => scorePerDollar(b.e) - scorePerDollar(a.e))[0].m;
}

// ── localStorage-backed wrappers ─────────────────────────────────────────────

export function loadLedger(): ModelLedger {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as ModelLedger;
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

function save(ledger: ModelLedger) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ledger));
  } catch {
    /* best-effort */
  }
}

/** Record one deep-think run's quality/cost for its thinking model. */
export function recordModelRun(model: string, score: number, cost: number): void {
  if (!model || score < 0) return;
  save(recordRunInto(loadLedger(), model, score, cost));
}

/** Number of models with recorded runs (for the settings UI). */
export function ledgerSize(): number {
  return Object.keys(loadLedger()).length;
}

export function clearModelLedger(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* non-fatal */
  }
}
