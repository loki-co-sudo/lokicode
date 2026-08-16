// Deterministic evaluation harness (deepthink-v3-roadmap P8; paid, real API).
// Runs the fixed task set (`e2e/harness/tasks.ts`) against the production
// deep-think pipeline, grades each result with the non-LLM graders in
// `src/lib/graders.ts`, writes a TSV report, and diffs it against the previous
// run to surface structural/citation regressions.
//
// Run with: npm run e2e:harness
// Output:   e2e/harness/results/latest.tsv (overwritten each run; previous
//           run archived under e2e/harness/results/history/ first)

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { installLocalStorage, callLog } from "./tauriShim";
import { TASKS, type Task } from "./harness/tasks";
import { gradeCitations, gradeCalls, type CallStats } from "../src/lib/graders";
import { formatTsv, parseTsv, diffRegressions, type TaskRunResult } from "../src/lib/harnessReport";
import type { ApiMessage } from "../src/lib/openrouter";

// Switched from the free nvidia/nemotron-3-ultra-550b-a55b:free (too slow —
// ~5-12min/task from weak-model tool-call inefficiency) to a fast paid
// thinking model at ひろ's request, after the first paid run measured the
// free model's actual wall-clock cost. Synthesis model unchanged (matches
// ひろ's configured 合成モデル).
const THINKING = "deepseek/deepseek-v4-flash-0731";
const SYNTHESIS = "deepseek/deepseek-v4-pro-0813";
const ROOT = process.cwd();
const RESULTS_DIR = join(ROOT, "e2e/harness/results");
const LATEST_PATH = join(RESULTS_DIR, "latest.tsv");
// The TSV (formatTsv) only carries name:ok per grader — no failure reason, no
// final text. A background run's captured console output can be lossy over
// long wall-clock times (observed: an hour-long run's interleaved per-task
// logs were dropped, leaving only the start/end banners), so a FAIL's cause
// was unrecoverable after the fact. This sidecar keeps the full grader
// `detail` strings and a capped final-answer preview alongside the compact
// TSV, so a failure can be diagnosed without re-running the (paid) task.
const LATEST_DETAIL_PATH = join(RESULTS_DIR, "latest-detail.json");
const HISTORY_DIR = join(RESULTS_DIR, "history");
const FINAL_TEXT_PREVIEW_CHARS = 4000;

const SYSTEM: ApiMessage = {
  role: "system",
  content:
    `You are lokicode's coding agent embedded in a desktop code editor on Linux. ` +
    `Use the provided read-only tools (read_file / grep_search / list_dir) to inspect the ` +
    `workspace instead of guessing. Use POSIX paths. ` +
    `The open workspace folder is: ${ROOT}. Reply in the user's language (Japanese).`,
};

/** Resolve a cited path (absolute or repo-relative) and read it — mirrors
 * `reasoning.ts`'s `makeCitedFileReader`, reimplemented over Node fs since the
 * harness shims Tauri's invoke rather than going through it for this read. */
async function readCitedFile(path: string): Promise<string | null> {
  const abs = isAbsolute(path) ? path : join(ROOT, path);
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

interface TaskRunDetail {
  result: TaskRunResult;
  finalTextPreview: string;
}

async function runTask(task: Task, previousCalls: CallStats[] | null): Promise<TaskRunDetail> {
  const { runRecurrentReasoning } = await import("../src/lib/reasoning");
  const { setEffort } = await import("../src/lib/agentSettings");
  setEffort(task.effort);
  const startCall = callLog.length;
  const t0 = Date.now();
  let finalText = "";
  let usd = 0;

  await runRecurrentReasoning(
    [SYSTEM, { role: "user", content: task.prompt }],
    {
      depth: task.depth,
      samples: task.samples,
      thinkingModel: THINKING,
      synthesisModel: SYNTHESIS,
      useTools: true,
      approval: "standard",
      workspaceRoot: ROOT,
      decompose: task.decompose,
      beamSearch: task.beamSearch,
    },
    {
      onThought: (label, _model, content) => {
        console.log(`  [thought] ${label}: ${content.slice(0, 200).replace(/\n/g, " ")}`);
      },
      onFinal: (text) => {
        finalText = text;
      },
      onToolStart: () => {},
      onToolEnd: () => {},
      approve: async () => false, // all current tasks are read-only ("deep" route)
      onUsage: (u) => {
        usd += u.cost;
      },
    },
  );

  const seconds = (Date.now() - t0) / 1000;
  const calls = callLog.length - startCall;
  const callStats: CallStats[] = [{ phase: "total", calls }];

  const graderResults = [];
  for (const g of task.graders) {
    if (g.kind === "citations") graderResults.push(await gradeCitations(finalText, readCitedFile));
    else if (g.kind === "calls") graderResults.push(gradeCalls(callStats, previousCalls));
  }

  return {
    result: {
      taskId: task.id,
      route: task.route,
      pass: graderResults.every((g) => g.ok),
      graders: graderResults,
      calls,
      seconds,
      usd,
    },
    finalTextPreview:
      finalText.length > FINAL_TEXT_PREVIEW_CHARS
        ? finalText.slice(0, FINAL_TEXT_PREVIEW_CHARS) + `\n…(${finalText.length - FINAL_TEXT_PREVIEW_CHARS} 文字省略)`
        : finalText,
  };
}

// Free/weak thinking models can wander for minutes per tool-read turn (this
// repo's own effort-preset docs note it: "軽量モデルは1ターン1読みで数十回徘徊").
// Give the whole 6-task run generous headroom rather than the config's default
// 30min-per-test, and write the report INCREMENTALLY (after every task, not
// only at the end) so a slow model that ultimately times out still leaves a
// usable partial report instead of losing the whole run's progress/cost.
const HARNESS_TIMEOUT_MS = 3 * 60 * 60 * 1000; // 3 hours

describe("deterministic evaluation harness (P8)", () => {
  beforeAll(() => installLocalStorage());

  it(
    `runs the fixed task set (${TASKS.length} tasks) and grades deterministically`,
    async () => {
      let previous: TaskRunResult[] = [];
      if (existsSync(LATEST_PATH)) {
        try {
          previous = parseTsv(readFileSync(LATEST_PATH, "utf8"));
        } catch (e) {
          console.warn(`[harness] could not parse previous report, treating as no baseline: ${e}`);
        }
      }
      const prevByTask = new Map(previous.map((r) => [r.taskId, r]));

      mkdirSync(RESULTS_DIR, { recursive: true });
      if (existsSync(LATEST_PATH)) {
        mkdirSync(HISTORY_DIR, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        copyFileSync(LATEST_PATH, join(HISTORY_DIR, `${stamp}.tsv`));
        if (existsSync(LATEST_DETAIL_PATH)) {
          copyFileSync(LATEST_DETAIL_PATH, join(HISTORY_DIR, `${stamp}-detail.json`));
        }
      }

      const results: TaskRunResult[] = [];
      const details: TaskRunDetail[] = [];
      for (const task of TASKS) {
        console.log(`\n=== [harness] task "${task.id}" — ${task.note} ===`);
        const prevCalls = prevByTask.get(task.id);
        const detail = await runTask(
          task,
          prevCalls ? [{ phase: "total", calls: prevCalls.calls }] : null,
        );
        const r = detail.result;
        results.push(r);
        details.push(detail);
        console.log(
          `  → ${r.pass ? "PASS" : "FAIL"} · calls=${r.calls} · ${r.seconds.toFixed(1)}s · $${r.usd.toFixed(4)}`,
        );
        if (!r.pass) {
          for (const g of r.graders) {
            if (!g.ok) console.log(`    ✗ ${g.name}: ${g.detail}`);
          }
        }
        // Incremental write: a partial report (fewer rows than TASKS.length)
        // is still useful and still cheaper than losing everything to a
        // later timeout/crash. Same reasoning for the detail sidecar — a
        // long-running background capture can drop console output before the
        // process exits (observed), so the failure reason must land on disk
        // as it happens, not only in a final summary.
        writeFileSync(LATEST_PATH, formatTsv(results) + "\n");
        writeFileSync(LATEST_DETAIL_PATH, JSON.stringify(details, null, 2) + "\n");
      }

      const regressions = diffRegressions(results, previous);
      if (regressions.length > 0) {
        console.log("\n[harness] regressions vs previous run:");
        for (const r of regressions) console.log(`  - ${r.taskId}: ${r.message}`);
      } else {
        console.log("\n[harness] no regressions vs previous run.");
      }
      console.log(`\n[harness] report written to ${LATEST_PATH}`);

      // Sanity, not a quality gate: every task ran and produced a result.
      expect(results).toHaveLength(TASKS.length);
    },
    HARNESS_TIMEOUT_MS,
  );
});
