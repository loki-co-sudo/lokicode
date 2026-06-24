// User-tunable agent runtime limits (persisted in localStorage).

const ITER_KEY = "lokicode.maxIterations";
const TIMEOUT_KEY = "lokicode.commandTimeout";

export const DEFAULT_MAX_ITERATIONS = 50;
export const DEFAULT_COMMAND_TIMEOUT = 60; // seconds

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
