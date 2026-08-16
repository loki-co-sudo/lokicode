// Non-LLM graders for the deterministic evaluation harness (deepthink-v3-
// roadmap P8). Every grader here is pure or takes its inputs as plain data —
// no OpenRouter calls, no judgment calls delegated to a model. The e2e harness
// (`e2e/harness/`) is the only piece that talks to the network; this module is
// unit-tested under `npm test` like every other pure-logic module.

import { extractCitations, validateCitations } from "./citations";

export interface GraderResult {
  name: string;
  ok: boolean;
  detail: string;
}

/** citations grader (P8 §2): every `path:line` cited in the final answer text
 * must resolve to a real file/line. Reuses `citations.ts` stage 1 (path exists,
 * line in range); stage 2 (excerpt match) activates automatically once P9
 * changes the investigator output to carry quoted excerpts — this grader does
 * not need to change when that happens, since `validateCitations` already
 * skips stage 2 for citations with no quote. */
export async function gradeCitations(
  text: string,
  readFile: (path: string) => Promise<string | null>,
): Promise<GraderResult> {
  const cites = extractCitations(text);
  if (cites.length === 0) return { name: "citations", ok: true, detail: "citations: 0 (none cited)" };
  const { ok, invalid } = await validateCitations(cites, readFile);
  const detail = ok
    ? `${cites.length}/${cites.length} valid`
    : `${cites.length - invalid.length}/${cites.length} valid; invalid: ` +
      invalid.map((i) => `${i.path}:${i.line}(${i.reason})`).join(", ");
  return { name: "citations", ok, detail };
}

/** exit grader (P8 §2): the expected verification command's exit code. */
export function gradeExit(code: number, expected = 0): GraderResult {
  return { name: "exit", ok: code === expected, detail: `exit=${code} expected=${expected}` };
}

/** edits grader (P8 §2): every path the task expects to be changed actually
 * changed (pre/post content hash differs — `changed` is the caller-computed
 * set of paths whose hash differs from before the run). */
export function gradeEdits(expectedPaths: string[], changed: ReadonlySet<string>): GraderResult {
  if (expectedPaths.length === 0) return { name: "edits", ok: true, detail: "no expected edits" };
  const missing = expectedPaths.filter((p) => !changed.has(p));
  return {
    name: "edits",
    ok: missing.length === 0,
    detail: missing.length ? `missing: ${missing.join(", ")}` : `all ${expectedPaths.length} edited`,
  };
}

/** forbidden grader (P8 §2): the machine-checked form of a brief's CONSTRAINTS
 * — none of the listed paths were touched. */
export function gradeForbidden(forbiddenPaths: string[], changed: ReadonlySet<string>): GraderResult {
  if (forbiddenPaths.length === 0) return { name: "forbidden", ok: true, detail: "none declared" };
  const violated = forbiddenPaths.filter((p) => changed.has(p));
  return {
    name: "forbidden",
    ok: violated.length === 0,
    detail: violated.length ? `violated: ${violated.join(", ")}` : `none of ${forbiddenPaths.length} touched`,
  };
}

export interface CallStats {
  phase: string;
  calls: number;
}

/** calls grader (P8 §2): NOT a pass/fail gate (call counts naturally vary with
 * data-dependent branches like sufficiency gaps) — it always reports `ok: true`
 * and exists purely to surface a structural regression (a phase's call count
 * jumping) in the diff against the previous run's TSV row. */
export function gradeCalls(observed: CallStats[], previous: CallStats[] | null): GraderResult {
  const totalNow = observed.reduce((n, c) => n + c.calls, 0);
  if (!previous) return { name: "calls", ok: true, detail: `calls=${totalNow} (no baseline)` };
  const totalPrev = previous.reduce((n, c) => n + c.calls, 0);
  const delta = totalNow - totalPrev;
  const sign = delta >= 0 ? "+" : "";
  return { name: "calls", ok: true, detail: `calls=${totalNow} (prev=${totalPrev}, Δ${sign}${delta})` };
}
