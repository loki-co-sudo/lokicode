// User-tunable agent runtime limits (persisted in localStorage).

const ITER_KEY = "lokicode.maxIterations";
const TIMEOUT_KEY = "lokicode.commandTimeout";
const VERIFY_KEY = "lokicode.verifyCommand";
const RESTRICT_KEY = "lokicode.restrictToWorkspace";
const EFFORT_KEY = "lokicode.effort";
const LOOP_KEY = "lokicode.loopMode";
const TERMINAL_SHELL_KEY = "lokicode.terminalShell";

/** Max times the agent re-runs the verify command and fixes failures. */
export const MAX_VERIFY_ATTEMPTS = 2;

export const DEFAULT_MAX_ITERATIONS = 50;
export const DEFAULT_COMMAND_TIMEOUT = 60; // seconds

/** Default thinking model when the user hasn't chosen one. OpenRouter's free
 * router ("Free Models Router") — cost-recommended for the high-volume thinking
 * phases (investigation/verification/draft). */
export const DEFAULT_THINKING_MODEL = "openrouter/free";

export const MAX_ITERATIONS_RANGE = [1, 500] as const;
export const COMMAND_TIMEOUT_RANGE = [1, 600] as const; // backend clamps to this too

function read(key: string, def: number, min: number, max: number): number {
  const v = Number(localStorage.getItem(key));
  return Number.isFinite(v) && v >= min && v <= max ? Math.floor(v) : def;
}

/** Max tool-call rounds the agent loop runs before stopping. */
export function getMaxIterations(): number {
  return read(ITER_KEY, DEFAULT_MAX_ITERATIONS, MAX_ITERATIONS_RANGE[0], MAX_ITERATIONS_RANGE[1]);
}

/** Seconds before a run_command child process is force-killed. */
export function getCommandTimeout(): number {
  return read(TIMEOUT_KEY, DEFAULT_COMMAND_TIMEOUT, COMMAND_TIMEOUT_RANGE[0], COMMAND_TIMEOUT_RANGE[1]);
}

export function setMaxIterations(n: number) {
  try {
    localStorage.setItem(ITER_KEY, String(n));
  } catch {
    /* non-fatal */
  }
}

export function setCommandTimeout(n: number) {
  try {
    localStorage.setItem(TIMEOUT_KEY, String(n));
  } catch {
    /* non-fatal */
  }
}

/** Optional command run after the agent edits files; on failure the agent is
 * asked to fix and it re-runs (execution-grounded self-correction). Empty = off. */
export function getVerifyCommand(): string {
  return (localStorage.getItem(VERIFY_KEY) ?? "").trim();
}

export function setVerifyCommand(s: string) {
  try {
    localStorage.setItem(VERIFY_KEY, s);
  } catch {
    /* non-fatal */
  }
}

// ── Reasoning effort (cost/speed vs accuracy) ────────────────────────────────
// One coarse user-facing preset that maps to the pipeline's tuning knobs, per
// test-time-compute scaling findings (verifier-guided halting threshold, MoA /
// best-of-N width, sufficiency-gate rounds). See specs/effort-presets.md.

export type EffortLevel = "speed" | "balanced" | "quality";

export interface EffortParams {
  /** Verifier pass mark: stop refining once the judge scores at/above this. */
  passScore: number;
  /** Below this the refine escalates to the strong model. */
  escalateBelow: number;
  /** Mixture-of-Agents / best-of-N width (1 = ensemble disabled). */
  ensembleSamples: number;
  /** Max sufficiency→gap-fill rounds before drafting. */
  sufficiencyRounds: number;
  /** Parallel LLM-as-judge samples per verify round (score = min, defects =
   * union) — self-consistency smoothing for the verifier, quality tier only. */
  judgeSamples: number;
  /** Max tool-loop rounds for deep-think's read-only phases (investigation /
   * refine). Measured in the 1.4.1 e2e run: information saturates after ~6-8
   * reads; beyond that a small model re-reads files one turn at a time while
   * the context (and latency) balloons. */
  phaseIterations: number;
}

/** Width/threshold steps follow the diminishing-returns curve of parallel
 * sampling (the 1→2 gain is the largest; 3+ tapers off). */
export const EFFORT_PARAMS: Record<EffortLevel, EffortParams> = {
  speed: { passScore: 78, escalateBelow: 60, ensembleSamples: 1, sufficiencyRounds: 1, judgeSamples: 1, phaseIterations: 6 },
  balanced: { passScore: 85, escalateBelow: 70, ensembleSamples: 2, sufficiencyRounds: 2, judgeSamples: 1, phaseIterations: 10 },
  quality: { passScore: 92, escalateBelow: 78, ensembleSamples: 3, sufficiencyRounds: 3, judgeSamples: 2, phaseIterations: 14 },
};

export const DEFAULT_EFFORT: EffortLevel = "balanced";

export function getEffort(): EffortLevel {
  try {
    const v = localStorage.getItem(EFFORT_KEY);
    if (v === "speed" || v === "balanced" || v === "quality") return v;
  } catch {
    /* no storage (tests) → default */
  }
  return DEFAULT_EFFORT;
}

export function setEffort(level: EffortLevel) {
  try {
    localStorage.setItem(EFFORT_KEY, level);
  } catch {
    /* non-fatal */
  }
}

export function getEffortParams(): EffortParams {
  return EFFORT_PARAMS[getEffort()];
}

/** Per-effort operating instructions appended to the agent system prompt: how
 * much optional verification / context gathering to spend. */
export const EFFORT_AGENT_GUIDANCE: Record<EffortLevel, string> = {
  speed:
    "- Effort level: SPEED. Finish in the fewest steps: skip optional verification reads, " +
    "do not re-check work that is unlikely to have failed, and keep the final answer to the essentials.",
  balanced:
    "- Effort level: BALANCED. Verify a change only when it could plausibly have failed; " +
    "keep answers concise but complete.",
  quality:
    "- Effort level: QUALITY. After each substantive change, verify it (re-read the changed " +
    "region; run the build/tests when cheap). Before finishing, check the result against each " +
    "stated requirement one by one and fix any miss.",
};

/** Loop-mode toggle (same key the ChatPane Toggle persists): raises the verify
 * loop's attempt cap from MAX_VERIFY_ATTEMPTS to LOOP_MAX_ATTEMPTS. Read here
 * so deep-think's execute phase (frontier-roadmap P1) sees the same setting. */
export function getLoopMode(): boolean {
  try {
    return localStorage.getItem(LOOP_KEY) === "1";
  } catch {
    return false;
  }
}

/** When on, the agent's file tools (read/write/list/grep) and run_command's cwd
 * are confined to the open workspace folder — a guard against a prompt-injected
 * agent reading secrets elsewhere (e.g. ~/.ssh) and sending them to the model.
 * Default ON (secure by default); only applies when a workspace is open. */
export function getRestrictToWorkspace(): boolean {
  // Absent key → default true. Only "0" disables.
  return localStorage.getItem(RESTRICT_KEY) !== "0";
}

export function setRestrictToWorkspace(on: boolean) {
  try {
    localStorage.setItem(RESTRICT_KEY, on ? "1" : "0");
  } catch {
    /* non-fatal */
  }
}

/** Preferred shell for newly-opened INTEGRATED TERMINAL sessions (id from
 * `terminal.ts` `listShells()`). Empty = auto = previous fixed-default
 * behavior. Does not affect the agent's `run_command` shell (scoped to the
 * terminal only — see specs/terminal-shell-selection.md). Applies to the next
 * terminal opened; existing sessions are unaffected. */
export function getTerminalShell(): string {
  try {
    return localStorage.getItem(TERMINAL_SHELL_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setTerminalShell(v: string) {
  try {
    localStorage.setItem(TERMINAL_SHELL_KEY, v);
  } catch {
    /* non-fatal */
  }
}
