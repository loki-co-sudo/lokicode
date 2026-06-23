// Recurrent-Depth reasoning core (OpenMythos-inspired).
//
// Instead of a single API call, we run an external loop that drafts a solution,
// then reflects/self-corrects D times (P1 Recurrent-Depth Loop), using a cheap
// model for the thinking phases and a strong model for the final synthesis
// (P2 Cost-Efficient Routing). D is user-controlled (P3 Adaptive Compute Control).
//
// When `useTools` is enabled, each thinking phase is itself a tool-using agent
// mini-loop (§3.3 "脳と手の融合"), so self-verification is grounded in real files
// and command output rather than the model's imagination.
//
// See /specs/architecture.md.

import { complete, type ApiMessage, type Usage } from "./openrouter";
import { runAgent, type ToolStatus } from "./agent";

export interface ReasoningCallbacks {
  /** Emitted for the draft and each reflection (thinking phases). */
  onThought: (label: string, model: string, content: string) => void;
  /** Emitted once with the final synthesized answer. */
  onFinal: (text: string) => void;
  // Tool events (used only when useTools); mirror the agent's callbacks.
  onToolStart: (call: { name: string; args: Record<string, unknown> }) => void;
  onToolEnd: (status: ToolStatus, result: string) => void;
  approve: (name: string, args: Record<string, unknown>) => Promise<boolean>;
  onUsage?: (usage: Usage) => void;
  onFileEdit?: (path: string, prev: string | null) => void;
}

export interface ReasoningOptions {
  /** Number of reflection iterations (1–16). */
  depth: number;
  /** Number of independent drafts to generate in parallel and merge (1 = off). */
  samples?: number;
  /** Cheap model for draft/reflection. Falls back to the default model. */
  thinkingModel?: string;
  /** Strong model for final synthesis. Falls back to the default model. */
  synthesisModel?: string;
  /** Let each thinking phase use tools (read/write/list/run). */
  useTools: boolean;
  autoApprove: boolean;
  signal?: { aborted: boolean };
}

export const MAX_DEPTH = 16;
export const MAX_SAMPLES = 5;

const DRAFT_NUDGE: ApiMessage = {
  role: "system",
  content:
    "Provide your best initial solution to the user's request, with brief reasoning. Be concrete.",
};

function clampDepth(d: number): number {
  return Math.max(1, Math.min(MAX_DEPTH, Math.floor(d)));
}

export async function runRecurrentReasoning(
  base: ApiMessage[],
  opts: ReasoningOptions,
  cb: ReasoningCallbacks,
): Promise<void> {
  const thinking = opts.thinkingModel;
  const synthesis = opts.synthesisModel;
  const depth = clampDepth(opts.depth);
  const thinkingLabel = thinking || "(default)";

  // A "think" step: a tool-using agent mini-loop when useTools, else a plain completion.
  const think = async (messages: ApiMessage[], model?: string): Promise<string> => {
    if (opts.useTools) {
      return runAgent(
        messages,
        {
          onAssistantText: () => {}, // intermediate text is folded into the phase result
          onToolStart: cb.onToolStart,
          onToolEnd: cb.onToolEnd,
          approve: cb.approve,
          onUsage: cb.onUsage,
          onFileEdit: cb.onFileEdit,
        },
        { autoApprove: opts.autoApprove, model, signal: opts.signal },
      );
    }
    const { content, usage } = await complete(messages, model);
    cb.onUsage?.(usage);
    return content;
  };

  // Phase 0 — draft (thinking model). With self-consistency (samples > 1) we
  // generate several independent drafts in parallel and merge them by "voting".
  // Parallel sampling is skipped when tools are on (would race on approvals).
  const samples = opts.useTools ? 1 : Math.max(1, Math.min(MAX_SAMPLES, Math.floor(opts.samples ?? 1)));
  let draft: string;
  if (samples > 1) {
    const drafts = await Promise.all(
      Array.from({ length: samples }, () => think([...base, DRAFT_NUDGE], thinking)),
    );
    if (opts.signal?.aborted) return;
    drafts.forEach((d, i) => cb.onThought(`ドラフト候補 ${i + 1}/${samples}`, thinkingLabel, d));
    const voteMessages: ApiMessage[] = [
      ...base,
      {
        role: "user",
        content:
          "以下は同じ課題に対する複数の独立した解です。各案の正しさ・完全性を比較し、" +
          "最も妥当な内容を採用・統合して、単一の最良の解にまとめてください。\n\n" +
          drafts.map((d, i) => `### 案 ${i + 1}\n${d}`).join("\n\n"),
      },
    ];
    draft = await think(voteMessages, synthesis ?? thinking);
    cb.onThought("候補の統合（self-consistency）", synthesis || thinkingLabel, draft);
  } else {
    draft = await think([...base, DRAFT_NUDGE], thinking);
    cb.onThought("初期ドラフト", thinkingLabel, draft);
  }

  // Phase 1..D — reflect & refine (thinking model), with convergence early-stop.
  for (let k = 1; k <= depth; k++) {
    if (opts.signal?.aborted) return;
    const reflectMessages: ApiMessage[] = [
      ...base,
      { role: "assistant", content: draft },
      {
        role: "user",
        content:
          "上記の解を批判的に検証し、誤り・不足・改善点を具体的に指摘した上で、改善した完全な解を提示してください。" +
          (opts.useTools ? "必要ならツールでファイルを読んだりコマンドを実行して事実確認してください。" : "") +
          "\nもし既に正しく完全で実質的な改善が不要なら、出力の先頭行に `CONVERGED` とだけ書いてください。",
      },
    ];
    const reflected = await think(reflectMessages, thinking);

    // Early stop: the model signalled convergence — avoid wasting further API calls.
    if (/^\s*CONVERGED\b/i.test(reflected)) {
      const stripped = reflected.replace(/^\s*CONVERGED\b[ \t]*\n?/i, "").trim();
      if (stripped.length > 40) draft = stripped;
      cb.onThought(`収束（早期終了 ${k}/${depth}）`, thinkingLabel, draft);
      break;
    }

    draft = reflected;
    cb.onThought(`内省 ${k}/${depth}`, thinkingLabel, draft);
  }

  if (opts.signal?.aborted) return;

  // Phase final — synthesis (strong model).
  const synthesisMessages: ApiMessage[] = [
    ...base,
    { role: "assistant", content: draft },
    {
      role: "user",
      content:
        "これまでの検討を踏まえ、ユーザー向けの最終回答を簡潔かつ正確にまとめてください。コードは適切なコードブロックで示してください。",
    },
  ];
  const final = await think(synthesisMessages, synthesis);
  cb.onFinal(final);
}
