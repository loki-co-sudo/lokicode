// Recurrent-Depth reasoning core (OpenMythos-inspired).
//
// Instead of a single API call, we run an external loop that drafts a solution,
// then reflects/self-corrects D times (P1 Recurrent-Depth Loop), using a cheap
// model for the thinking phases and a strong model for the final synthesis
// (P2 Cost-Efficient Routing). D is user-controlled (P3 Adaptive Compute Control).
//
// See /specs/architecture.md.

import { complete, type ApiMessage } from "./openrouter";

export interface ReasoningCallbacks {
  /** Emitted for the draft and each reflection (thinking phases). */
  onThought: (label: string, model: string, content: string) => void;
  /** Emitted once with the final synthesized answer. */
  onFinal: (text: string) => void;
}

export interface ReasoningOptions {
  /** Number of reflection iterations (1–16). */
  depth: number;
  /** Cheap model for draft/reflection. Falls back to the default model. */
  thinkingModel?: string;
  /** Strong model for final synthesis. Falls back to the default model. */
  synthesisModel?: string;
  signal?: { aborted: boolean };
}

export const MAX_DEPTH = 16;

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

  // Phase 0 — draft (thinking model).
  let draft = await complete([...base, DRAFT_NUDGE], thinking);
  cb.onThought("初期ドラフト", thinkingLabel, draft);

  // Phase 1..D — reflect & refine (thinking model).
  for (let k = 1; k <= depth; k++) {
    if (opts.signal?.aborted) return;
    const reflectMessages: ApiMessage[] = [
      ...base,
      { role: "assistant", content: draft },
      {
        role: "user",
        content:
          "上記の解を批判的に検証し、誤り・不足・改善点を具体的に指摘した上で、改善した完全な解を提示してください。",
      },
    ];
    draft = await complete(reflectMessages, thinking);
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
  const final = await complete(synthesisMessages, synthesis);
  cb.onFinal(final);
}
