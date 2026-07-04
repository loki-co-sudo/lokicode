// Loop mode (verify loop) pure logic: attempt cap and the normalized error
// signature used for stuck detection. See specs/loop-mode.md.

/** Max change→verify→fix rounds when loop mode is ON (OFF uses the legacy 2). */
export const LOOP_MAX_ATTEMPTS = 5;

/**
 * Normalize a verify-command log into a comparable signature so "the same
 * error happened twice in a row" can be detected across runs whose incidental
 * details differ (durations, timestamps, counts, line numbers):
 * digits → '#', whitespace collapsed, compared on the last 600 chars (the
 * tail is where test runners print the actual failure).
 */
export function errorSignature(log: string): string {
  return log.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().slice(-600);
}

/** Last `n` non-empty lines of a command log — the "evidence" excerpt quoted
 * in the completion report. */
export function evidenceTail(log: string, n = 12): string {
  return log
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .slice(-n)
    .join("\n");
}
