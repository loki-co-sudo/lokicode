// End-to-end verification of the deep-think pipeline design (paid; real API).
// Checks that what specs/deep-reasoning-v2.md + effort-presets.md +
// router-effort-link.md describe actually happens with real models:
//   Run A (balanced): brief → parallel investigation → sufficiency → MoA draft
//                     → strong judge ×1/round → best-of-N final
//   Run B (quality):  minimum grounding fires on breadth=1, ensemble width 3,
//                     judge runs 2× per round (score=min, defects=union)

import { describe, it, expect, beforeAll } from "vitest";
import { installLocalStorage, callLog, toolLog } from "./tauriShim";
import type { ApiMessage } from "../src/lib/openrouter";

const THINKING = "deepseek/deepseek-v4-flash";
const SYNTHESIS = "deepseek/deepseek-v4-pro";
const ROOT = process.cwd();

const SYSTEM: ApiMessage = {
  role: "system",
  content:
    `You are lokicode's coding agent embedded in a desktop code editor on Windows. ` +
    `Use the provided read-only tools (read_file / grep_search / list_dir) to inspect the ` +
    `workspace instead of guessing. Use absolute Windows paths. ` +
    `The open workspace folder is: ${ROOT}. Reply in the user's language (Japanese).`,
};

interface RunResult {
  thoughts: { label: string; content: string }[];
  finalText: string;
  tools: string[];
  usd: number;
  judgeCalls: number;
  apiCalls: number;
}

async function runDeep(
  question: string,
  opts: { depth: number; samples: number; effort: "speed" | "balanced" | "quality" },
): Promise<RunResult> {
  const { runRecurrentReasoning } = await import("../src/lib/reasoning");
  const { setEffort } = await import("../src/lib/agentSettings");
  setEffort(opts.effort);
  const startCall = callLog.length;
  const thoughts: { label: string; content: string }[] = [];
  const tools: string[] = [];
  let finalText = "";
  let usd = 0;

  await runRecurrentReasoning(
    [SYSTEM, { role: "user", content: question }],
    {
      depth: opts.depth,
      samples: opts.samples,
      thinkingModel: THINKING,
      synthesisModel: SYNTHESIS,
      useTools: true,
      approval: "standard",
      workspaceRoot: ROOT,
    },
    {
      onThought: (label, _model, content) => {
        thoughts.push({ label, content });
        console.log(`\n== [thought] ${label} ==\n${content.slice(0, 400)}\n`);
      },
      onFinal: (text) => {
        finalText = text;
        console.log(`\n== [FINAL] ==\n${text.slice(0, 1200)}\n`);
      },
      onToolStart: (c) => tools.push(c.name),
      onToolEnd: () => {},
      approve: async () => false, // analysis runs are read-only; must never be asked
      onUsage: (u) => {
        usd += u.cost;
      },
    },
  );

  const runCalls = callLog.slice(startCall);
  const judgeCalls = runCalls.filter((c) => c.tail.includes("strict evaluator")).length;
  return { thoughts, finalText, tools, usd, judgeCalls, apiCalls: runCalls.length };
}

function labels(r: RunResult, prefix: string): string[] {
  return r.thoughts.map((t) => t.label).filter((l) => l.startsWith(prefix));
}

describe("deep-think e2e (deepseek v4 pro/flash)", () => {
  beforeAll(() => installLocalStorage());

  it("Run A — balanced: brief → grounded parallel investigation → MoA → strong judge → final", async () => {
    const r = await runDeep(
      "このリポジトリのディープシンク（src/lib/reasoning.ts）の検証フェーズについて、" +
        "(1) 早期終了する条件 (2) 改善が強モデルへ昇格する条件 を、根拠となる file:line の引用つきで正確に説明してください。",
      { depth: 2, samples: 2, effort: "balanced" },
    );

    // 設計ブリーフが GOAL/CRITERIA を持つ
    const brief = r.thoughts.find((t) => t.label.includes("ブリーフ"));
    expect(brief, "brief thought missing").toBeTruthy();
    expect(brief!.content).toMatch(/GOAL|目標/i);
    expect(brief!.content).toMatch(/CRITERIA|成功基準/i);

    // 並列調査が走り、実ツールで接地している
    expect(labels(r, "調査").length).toBeGreaterThanOrEqual(2);
    expect(r.tools.length, "no read-only tool was used — investigation not grounded").toBeGreaterThan(0);

    // 検証（強モデル judge）が走り、balanced では 1 本/ラウンド
    const verifyRounds = labels(r, "検証").length;
    expect(verifyRounds).toBeGreaterThanOrEqual(1);
    expect(r.judgeCalls).toBe(verifyRounds);

    // MoA ドラフト（幅2）と best-of-N 最終（幅2）
    expect(labels(r, "ドラフト案").length).toBe(2);
    expect(labels(r, "最終候補").length).toBe(2);

    // 最終回答は実在ファイルを引用して具体的
    expect(r.finalText.length).toBeGreaterThan(200);
    expect(r.finalText).toMatch(/reasoning\.ts/);

    console.log(
      `\n[RUN A SUMMARY] api=${r.apiCalls} judge=${r.judgeCalls} verifyRounds=${verifyRounds} ` +
        `tools=${r.tools.length} cost=$${r.usd.toFixed(4)}`,
    );
  });

  it("Run B — quality: minimum grounding on breadth=1, ensemble width 3, judge ×2/round", async () => {
    const r = await runDeep(
      "このリポジトリのエージェントの承認レベル『standard』では、どの操作が自動承認され、" +
        "どの操作が確認（承認待ち）になりますか？根拠となる file:line の引用つきで整理してください。",
      { depth: 3, samples: 1, effort: "quality" },
    );

    const order = r.thoughts.map((t) => t.label);

    // 最小接地: 広さ1×アンサンブルでもドラフト前に接地調査が1回走る
    const groundIdx = order.findIndex((l) => l.includes("接地調査"));
    const draftIdx = order.findIndex((l) => l.startsWith("ドラフト案"));
    expect(groundIdx, "minimum-grounding investigation did not run").toBeGreaterThanOrEqual(0);
    expect(draftIdx).toBeGreaterThan(groundIdx);
    expect(r.tools.length).toBeGreaterThan(0);

    // 品質エフォート: アンサンブル幅3
    expect(labels(r, "ドラフト案").length).toBe(3);
    expect(labels(r, "最終候補").length).toBe(3);

    // judge 多数決: 2本/ラウンド
    const verifyRounds = labels(r, "検証").length;
    expect(verifyRounds).toBeGreaterThanOrEqual(1);
    expect(r.judgeCalls).toBe(verifyRounds * 2);

    expect(r.finalText.length).toBeGreaterThan(200);
    expect(r.finalText).toMatch(/agent\.ts/);

    console.log(
      `\n[RUN B SUMMARY] api=${r.apiCalls} judge=${r.judgeCalls} verifyRounds=${verifyRounds} ` +
        `tools=${r.tools.length} cost=$${r.usd.toFixed(4)}`,
    );
    console.log(`\n[TOOL LOG] ${toolLog.length} fs-tool calls total`);
  });
});
