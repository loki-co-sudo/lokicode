// User-tunable agent runtime limits (persisted in localStorage).

const ITER_KEY = "lokicode.maxIterations";
const TIMEOUT_KEY = "lokicode.commandTimeout";
const VERIFY_KEY = "lokicode.verifyCommand";
const RESTRICT_KEY = "lokicode.restrictToWorkspace";

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
