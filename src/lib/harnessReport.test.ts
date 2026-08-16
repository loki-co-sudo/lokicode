import { describe, it, expect } from "vitest";
import { formatTsv, parseTsv, diffRegressions, mergeResults, type TaskRunResult } from "./harnessReport";

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

describe("mergeResults", () => {
  it("replaces a re-run task's row while leaving the others untouched", () => {
    const previous = [
      result({ taskId: "t1", pass: true }),
      result({ taskId: "t2", pass: false }),
      result({ taskId: "t3", pass: true }),
    ];
    const updated = [result({ taskId: "t2", pass: true, seconds: 99 })];
    const merged = mergeResults(previous, updated);
    expect(merged.map((r) => r.taskId)).toEqual(["t1", "t2", "t3"]);
    expect(merged[1]).toEqual(updated[0]); // t2 replaced
    expect(merged[0]).toEqual(previous[0]); // t1 untouched
    expect(merged[2]).toEqual(previous[2]); // t3 untouched
  });

  it("preserves task order from `previous`, ignoring `updated`'s order", () => {
    const previous = [result({ taskId: "a" }), result({ taskId: "b" }), result({ taskId: "c" })];
    const updated = [result({ taskId: "c", seconds: 1 }), result({ taskId: "a", seconds: 2 })];
    expect(mergeResults(previous, updated).map((r) => r.taskId)).toEqual(["a", "b", "c"]);
  });

  it("appends a genuinely new task ID not present in `previous`", () => {
    const previous = [result({ taskId: "a" })];
    const updated = [result({ taskId: "b" })];
    expect(mergeResults(previous, updated).map((r) => r.taskId)).toEqual(["a", "b"]);
  });

  it("returns `updated` as-is when `previous` is empty", () => {
    const updated = [result({ taskId: "a" }), result({ taskId: "b" })];
    expect(mergeResults([], updated)).toEqual(updated);
  });

  it("is a no-op when `updated` is empty", () => {
    const previous = [result({ taskId: "a" }), result({ taskId: "b" })];
    expect(mergeResults(previous, [])).toEqual(previous);
  });
});
