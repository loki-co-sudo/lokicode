// TSV report formatting + regression diffing for the deterministic evaluation
// harness (deepthink-v3-roadmap P8). Pure formatting/parsing logic only — the
// actual task execution (real OpenRouter calls) lives in `e2e/harness/`, which
// is not unit-tested (paid) but imports these functions so the report format
// itself IS unit-tested under `npm test`.

import type { GraderResult } from "./graders";

export interface TaskRunResult {
  taskId: string;
  route: string;
  pass: boolean;
  graders: GraderResult[];
  calls: number;
  seconds: number;
  usd: number;
}

const COLUMNS = ["taskId", "route", "pass", "calls", "seconds", "usd", "graders"] as const;

/** One row per task: pass/fail, call count, wall time, cost, and a compact
 * per-grader ok/fail summary (so a TSV diff shows WHICH grader regressed). */
export function formatTsv(results: TaskRunResult[]): string {
  const header = COLUMNS.join("\t");
  const rows = results.map((r) =>
    [
      r.taskId,
      r.route,
      r.pass ? "PASS" : "FAIL",
      String(r.calls),
      r.seconds.toFixed(1),
      r.usd.toFixed(4),
      r.graders.map((g) => `${g.name}:${g.ok ? "ok" : "FAIL"}`).join(","),
    ].join("\t"),
  );
  return [header, ...rows].join("\n");
}

/** Inverse of `formatTsv`, for loading a prior run's saved report to diff
 * against. Tolerant of a trailing newline; throws on a header mismatch so a
 * stale/foreign TSV can't silently misalign columns. */
export function parseTsv(tsv: string): TaskRunResult[] {
  const lines = tsv.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split("\t");
  if (header.join("\t") !== COLUMNS.join("\t")) {
    throw new Error(`harnessReport: unrecognized TSV header: ${lines[0]}`);
  }
  return lines.slice(1).map((line) => {
    const [taskId, route, passCol, calls, seconds, usd, gradersCol] = line.split("\t");
    const graders: GraderResult[] = gradersCol
      ? gradersCol.split(",").map((g) => {
          const [name, status] = g.split(":");
          return { name, ok: status === "ok", detail: "" };
        })
      : [];
    return {
      taskId,
      route,
      pass: passCol === "PASS",
      calls: Number(calls),
      seconds: Number(seconds),
      usd: Number(usd),
      graders,
    };
  });
}

export interface RegressionLine {
  taskId: string;
  message: string;
}

/** Compare a current run against a previous run's parsed report and surface
 * regressions: a task that newly fails, or a task where a specific grader that
 * used to pass now fails. New tasks (absent from `previous`) are reported as
 * informational, not regressions. Pure — no pass/fail verdict of its own, just
 * a list of human-readable lines for the harness to print. */
export function diffRegressions(current: TaskRunResult[], previous: TaskRunResult[]): RegressionLine[] {
  const prevById = new Map(previous.map((r) => [r.taskId, r]));
  const out: RegressionLine[] = [];
  for (const cur of current) {
    const prev = prevById.get(cur.taskId);
    if (!prev) {
      out.push({ taskId: cur.taskId, message: "new task (no baseline)" });
      continue;
    }
    if (prev.pass && !cur.pass) {
      out.push({ taskId: cur.taskId, message: "REGRESSION: task now FAILs (previously passed)" });
    }
    const prevGraders = new Map(prev.graders.map((g) => [g.name, g.ok]));
    for (const g of cur.graders) {
      const prevOk = prevGraders.get(g.name);
      if (prevOk === true && !g.ok) {
        out.push({ taskId: cur.taskId, message: `REGRESSION: grader "${g.name}" now fails` });
      }
    }
  }
  return out;
}
