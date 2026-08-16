import { describe, it, expect } from "vitest";
import { formatTsv, parseTsv, diffRegressions, type TaskRunResult } from "./harnessReport";

function result(overrides: Partial<TaskRunResult> = {}): TaskRunResult {
  return {
    taskId: "t1",
    route: "deep",
    pass: true,
    graders: [{ name: "citations", ok: true, detail: "1/1 valid" }],
    calls: 10,
    seconds: 12.3,
    usd: 0.0123,
    ...overrides,
  };
}

describe("formatTsv / parseTsv", () => {
  it("round-trips a single result", () => {
    const r = result();
    const tsv = formatTsv([r]);
    const parsed = parseTsv(tsv);
    expect(parsed).toEqual([
      {
        taskId: "t1",
        route: "deep",
        pass: true,
        calls: 10,
        seconds: 12.3,
        usd: 0.0123,
        graders: [{ name: "citations", ok: true, detail: "" }],
      },
    ]);
  });

  it("round-trips a failing result with multiple graders", () => {
    const r = result({
      pass: false,
      graders: [
        { name: "citations", ok: true, detail: "" },
        { name: "exit", ok: false, detail: "" },
      ],
    });
    const parsed = parseTsv(formatTsv([r]));
    expect(parsed[0].pass).toBe(false);
    expect(parsed[0].graders).toEqual([
      { name: "citations", ok: true, detail: "" },
      { name: "exit", ok: false, detail: "" },
    ]);
  });

  it("emits just the header for an empty result set", () => {
    expect(formatTsv([])).toBe("taskId\troute\tpass\tcalls\tseconds\tusd\tgraders");
    expect(parseTsv(formatTsv([]))).toEqual([]);
  });

  it("throws on a foreign/stale TSV header", () => {
    expect(() => parseTsv("wrong\theader\nfoo\tbar")).toThrow(/unrecognized TSV header/);
  });
});

describe("diffRegressions", () => {
  it("reports nothing when nothing changed", () => {
    const r = result();
    expect(diffRegressions([r], [r])).toEqual([]);
  });

  it("flags a new task as informational, not a regression", () => {
    const out = diffRegressions([result({ taskId: "new-task" })], []);
    expect(out).toEqual([{ taskId: "new-task", message: "new task (no baseline)" }]);
  });

  it("flags a task that flips from pass to fail", () => {
    const prev = [result({ pass: true })];
    const cur = [result({ pass: false })];
    const out = diffRegressions(cur, prev);
    expect(out).toContainEqual({
      taskId: "t1",
      message: "REGRESSION: task now FAILs (previously passed)",
    });
  });

  it("flags a specific grader that flips from ok to fail even if the task still passes overall", () => {
    const prev = [result({ graders: [{ name: "citations", ok: true, detail: "" }] })];
    const cur = [
      result({ pass: true, graders: [{ name: "citations", ok: false, detail: "" }] }),
    ];
    const out = diffRegressions(cur, prev);
    expect(out).toContainEqual({
      taskId: "t1",
      message: 'REGRESSION: grader "citations" now fails',
    });
  });

  it("does not flag a grader that was already failing", () => {
    const prev = [result({ pass: false, graders: [{ name: "exit", ok: false, detail: "" }] })];
    const cur = [result({ pass: false, graders: [{ name: "exit", ok: false, detail: "" }] })];
    expect(diffRegressions(cur, prev)).toEqual([]);
  });
});
