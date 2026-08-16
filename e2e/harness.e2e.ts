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

const THINKING = "deepseek/deepseek-v4-flash";
const SYNTHESIS = "deepseek/deepseek-v4-pro";
const ROOT = process.cwd();
const RESULTS_DIR = join(ROOT, "e2e/harness/results");
const LATEST_PATH = join(RESULTS_DIR, "latest.tsv");
const HISTORY_DIR = join(RESULTS_DIR, "history");

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

async function runTask(task: Task, previousCalls: CallStats[] | null): Promise<TaskRunResult> {
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
    taskId: task.id,
    route: task.route,
    pass: graderResults.every((g) => g.ok),
    graders: graderResults,
    calls,
    seconds,
    usd,
  };
}

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

      const results: TaskRunResult[] = [];
      for (const task of TASKS) {
        console.log(`\n=== [harness] task "${task.id}" — ${task.note} ===`);
        const prevCalls = prevByTask.get(task.id);
        const r = await runTask(
          task,
          prevCalls ? [{ phase: "total", calls: prevCalls.calls }] : null,
        );
        results.push(r);
        console.log(
          `  → ${r.pass ? "PASS" : "FAIL"} · calls=${r.calls} · ${r.seconds.toFixed(1)}s · $${r.usd.toFixed(4)}`,
        );
      }

      const regressions = diffRegressions(results, previous);
      if (regressions.length > 0) {
        console.log("\n[harness] regressions vs previous run:");
        for (const r of regressions) console.log(`  - ${r.taskId}: ${r.message}`);
      } else {
        console.log("\n[harness] no regressions vs previous run.");
      }

      mkdirSync(RESULTS_DIR, { recursive: true });
      if (existsSync(LATEST_PATH)) {
        mkdirSync(HISTORY_DIR, { recursive: true });
        copyFileSync(LATEST_PATH, join(HISTORY_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}.tsv`));
      }
      writeFileSync(LATEST_PATH, formatTsv(results) + "\n");
      console.log(`\n[harness] report written to ${LATEST_PATH}`);

      // Sanity, not a quality gate: every task ran and produced a result.
      expect(results).toHaveLength(TASKS.length);
    },
  );
});
