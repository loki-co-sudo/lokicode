// Deep-reasoning core.
//
// v2 (current default): an orchestrator–worker pipeline that beats naive
// self-refinement on research/analysis tasks:
//
//   Plan/decompose → parallel grounded Investigation (read-only tools)
//                  → evidence-based Draft
//                  → adversarial, evidence-checking Verify ×D (CONVERGED early-stop)
//                  → strong-model Final synthesis
//
// The cheap "thinking" model does the volume (investigations + verifications);
// the strong "synthesis" model does the three high-leverage steps (plan, draft,
// final). `samples` = breadth (how many independent angles), `depth` = number of
// verify/refine rounds. Both work with or without tools.
//
// v1 (original) was a linear self-refine chain: draft → "improve this" ×D →
// "summarize". It is preserved verbatim below as `runLinearRecurrentReasoning`.
//
// ── REVERT ────────────────────────────────────────────────────────────────
// To go back to the original behaviour, flip USE_ORCHESTRATOR to false (one
// line). The public entry point `runRecurrentReasoning` keeps the same
// signature, so nothing else has to change. See /specs/deep-reasoning-v2.md for
// the full rationale, the original algorithm, and the revert procedure.
// ────────────────────────────────────────────────────────────────────────────

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
  /** Number of verify/refine rounds (1–16). */
  depth: number;
  /** Breadth: independent investigation angles to explore (1 = no decomposition). */
  samples?: number;
  /** Cheap model for investigation/verification. Falls back to the default model. */
  thinkingModel?: string;
  /** Strong model for plan/draft/final synthesis. Falls back to the default model. */
  synthesisModel?: string;
  /** Let phases use tools (read/write/list/run/grep). */
  useTools: boolean;
  autoApprove: boolean;
  signal?: { aborted: boolean };
}

export const MAX_DEPTH = 16;
export const MAX_SAMPLES = 5;

/** Flip to false to revert to the original linear self-refine loop (v1). */
const USE_ORCHESTRATOR = true;

const MAX_EVIDENCE_CHARS = 9000;

function clampDepth(d: number): number {
  return Math.max(1, Math.min(MAX_DEPTH, Math.floor(d)));
}
function clampBreadth(b: number): number {
  return Math.max(1, Math.min(MAX_SAMPLES, Math.floor(b)));
}

/** Public entry point — dispatches to the active strategy. */
export async function runRecurrentReasoning(
  base: ApiMessage[],
  opts: ReasoningOptions,
  cb: ReasoningCallbacks,
): Promise<void> {
  return USE_ORCHESTRATOR
    ? runOrchestratedReasoning(base, opts, cb)
    : runLinearRecurrentReasoning(base, opts, cb);
}

// ─────────────────────────────────────────────────────────────────────────────
// v2 — Orchestrated reasoning
// ─────────────────────────────────────────────────────────────────────────────

const sys = (content: string): ApiMessage => ({ role: "system", content });
const usr = (content: string): ApiMessage => ({ role: "user", content });

const PLANNER = (n: number) =>
  sys(
    `You are the lead researcher decomposing a task. Identify the few (at most ${n}) ` +
      `MOST decision-relevant, INDEPENDENT investigation questions whose answers are ` +
      `jointly sufficient to solve the task well. Avoid overlap; prefer questions ` +
      `answerable from concrete evidence (code, files, command output). ` +
      `Output ONLY the questions, one per line, each prefixed with "Q: ". No preamble, no numbering.`,
  );

const INVESTIGATOR = sys(
  "You are investigating ONE sub-question of a larger task. Answer it precisely and " +
    "densely. Ground EVERY claim in concrete evidence — read the relevant files, list " +
    "directories, and grep to find code rather than guessing; cite file:line where " +
    "relevant. Explicitly separate VERIFIED facts from assumptions or open questions. " +
    "No filler, no restating the question.",
);

const DRAFT_FROM_EVIDENCE = usr(
  "Using the gathered findings above as the primary source of truth, produce the best " +
    "complete answer/solution to the user's task. Ground claims in the findings; do not " +
    "invent facts they do not support. Be concrete, specific and decisive.",
);

const DRAFT_PLAIN = usr(
  "Provide your best complete initial solution to the user's task, with concise, concrete reasoning.",
);

const CRITIC = (useTools: boolean) =>
  usr(
    "Act as a rigorous, skeptical reviewer. Audit the candidate answer above against the " +
      "user's task" +
      " and the gathered evidence" +
      ". List concrete defects: unsupported or incorrect claims, missing cases, logical " +
      "gaps, vague/generic reasoning, and better alternatives. " +
      (useTools
        ? "Use read-only tools to verify any suspicious claim (read files, grep, run read-only checks). "
        : "") +
      "Then output an IMPROVED, complete, evidence-grounded answer that fixes every issue.\n" +
      "If the answer is already correct, complete and well-supported with no material " +
      "improvement possible, reply with `CONVERGED` on the very first line (optionally " +
      "followed by the final answer).",
  );

const FINAL = usr(
  "You are the senior expert delivering the FINAL answer to the user. Considering the full " +
    "investigation and the refined draft, write the definitive response: decisive, specific " +
    "and correct; ground key claims in evidence (cite file:line where useful); surface real " +
    "uncertainties or risks honestly instead of hedging everything; no generic filler or " +
    "re-stating the question. Use Markdown, with code in fenced blocks. Reply in the user's language.",
);

function parseQuestions(text: string, max: number): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let qs = lines
    .filter((l) => /^Q[:：]/i.test(l))
    .map((l) => l.replace(/^Q[:：]\s*/i, "").trim())
    .filter(Boolean);
  if (qs.length === 0) {
    // Fallback: accept numbered or bulleted lines.
    qs = lines
      .filter((l) => /^(\d+[.)]|[-*•])\s+/.test(l))
      .map((l) => l.replace(/^(\d+[.)]|[-*•])\s+/, "").trim())
      .filter(Boolean);
  }
  return qs.slice(0, max);
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "\n…(以下省略)" : text;
}

async function runOrchestratedReasoning(
  base: ApiMessage[],
  opts: ReasoningOptions,
  cb: ReasoningCallbacks,
): Promise<void> {
  const thinking = opts.thinkingModel; // cheap; undefined → default model
  const synthesis = opts.synthesisModel; // strong; undefined → default model
  const depth = clampDepth(opts.depth);
  const breadth = clampBreadth(opts.samples ?? 1);
  const thinkingLabel = thinking || "(default)";
  const synthLabel = synthesis || thinkingLabel;
  const aborted = () => opts.signal?.aborted === true;

  // A reasoning step: a tool-using agent mini-loop when useTools, else a plain
  // completion. `tools:false` forces a plain completion even in tool mode (for
  // planning / synthesis, which don't need to touch the machine).
  const think = async (
    messages: ApiMessage[],
    model: string | undefined,
    o: { tools?: boolean; readOnly?: boolean } = {},
  ): Promise<string> => {
    if (opts.useTools && o.tools !== false) {
      return runAgent(
        messages,
        {
          onAssistantText: () => {},
          onToolStart: cb.onToolStart,
          onToolEnd: cb.onToolEnd,
          approve: cb.approve,
          onUsage: cb.onUsage,
          onFileEdit: cb.onFileEdit,
        },
        { autoApprove: opts.autoApprove, model, signal: opts.signal, readOnly: o.readOnly },
      );
    }
    const { content, usage } = await complete(messages, model);
    cb.onUsage?.(usage);
    return content;
  };

  // ── Phase A — Plan / decompose (only when breadth > 1) ──────────────────────
  let evidence = "";
  if (breadth > 1) {
    const plan = await think([...base, PLANNER(breadth)], synthesis, { tools: false });
    if (aborted()) return;
    cb.onThought("調査計画", synthLabel, plan);
    const questions = parseQuestions(plan, breadth);

    if (questions.length >= 2) {
      // ── Phase B — Investigation (read-only, grounded) ───────────────────────
      const investigate = async (q: string, i: number): Promise<string> => {
        const r = await think([...base, INVESTIGATOR, usr(`Sub-question: ${q}`)], thinking, {
          readOnly: true,
        });
        cb.onThought(`調査 ${i + 1}/${questions.length}`, thinkingLabel, r);
        return `### 調査: ${q}\n${r}`;
      };

      let findings: string[];
      if (opts.useTools) {
        // Serial when tools are on: keeps tool cards correctly ordered.
        findings = [];
        for (let i = 0; i < questions.length; i++) {
          if (aborted()) return;
          findings.push(await investigate(questions[i], i));
        }
      } else {
        // Pure completions: safe and fast to run in parallel.
        findings = await Promise.all(questions.map((q, i) => investigate(q, i)));
      }
      if (aborted()) return;
      evidence = clip(findings.join("\n\n"), MAX_EVIDENCE_CHARS);
    }
  }

  // ── Phase C — Draft (evidence-grounded when we have findings) ───────────────
  const evidenceMsgs: ApiMessage[] = evidence
    ? [sys(`収集された調査結果（根拠。以後の判断はこれを優先）:\n\n${evidence}`)]
    : [];
  let draft = await think(
    [...base, ...evidenceMsgs, evidence ? DRAFT_FROM_EVIDENCE : DRAFT_PLAIN],
    synthesis,
    { readOnly: true },
  );
  if (aborted()) return;
  cb.onThought(evidence ? "統合ドラフト" : "初期ドラフト", synthLabel, draft);

  // ── Phase D — Adversarial verify & refine (cheap model), CONVERGED early-stop ─
  for (let k = 1; k <= depth; k++) {
    if (aborted()) return;
    const reflected = await think(
      [...base, ...evidenceMsgs, { role: "assistant", content: draft }, CRITIC(opts.useTools)],
      thinking,
    );
    if (/^\s*CONVERGED\b/i.test(reflected)) {
      const stripped = reflected.replace(/^\s*CONVERGED\b[ \t]*\n?/i, "").trim();
      if (stripped.length > 40) draft = stripped;
      cb.onThought(`収束（早期終了 ${k}/${depth}）`, thinkingLabel, draft);
      break;
    }
    draft = reflected;
    cb.onThought(`検証 ${k}/${depth}`, thinkingLabel, draft);
  }
  if (aborted()) return;

  // ── Phase E — Final synthesis (strong model) ────────────────────────────────
  const final = await think(
    [...base, ...evidenceMsgs, { role: "assistant", content: draft }, FINAL],
    synthesis,
    { readOnly: true },
  );
  cb.onFinal(final);
}

// ─────────────────────────────────────────────────────────────────────────────
// v1 — Original linear self-refine loop (PRESERVED for revert; see USE_ORCHESTRATOR)
// ─────────────────────────────────────────────────────────────────────────────

const DRAFT_NUDGE: ApiMessage = {
  role: "system",
  content:
    "Provide your best initial solution to the user's request, with brief reasoning. Be concrete.",
};

export async function runLinearRecurrentReasoning(
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
