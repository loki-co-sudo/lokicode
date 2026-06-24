// Deep-reasoning core: an orchestrator–worker pipeline.
//
//   Brief (intent + criteria + plan) → parallel grounded Investigation
//        → Sufficiency gate → evidence-based Draft (Mixture-of-Agents)
//        → verifier-guided Verify ×D (LLM-as-judge, escalation)
//        → strong-model Final synthesis (best-of-N selection)
//
// The cheap "thinking" model does the volume (investigation/verification/draft);
// the strong "synthesis" model does the high-leverage steps (brief, final).
// `samples` = breadth (independent angles), `depth` = verify/refine rounds.
// See /specs/deep-reasoning-v2.md for the full design rationale.

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
  /** Mixture-of-Agents (parallel proposer drafts + best-of-N final). Default on;
   * turn off to trade a little quality for speed/cost. */
  ensemble?: boolean;
  signal?: { aborted: boolean };
}

export const MAX_DEPTH = 16;
export const MAX_SAMPLES = 5;

const MAX_EVIDENCE_CHARS = 9000;
/** Verifier pass mark: stop refining once the judge scores at/above this. */
const PASS_SCORE = 85;
/** Below this (past the midpoint) the refine escalates to the strong model. */
const ESCALATE_BELOW = 70;
/** Ensemble width (Mixture-of-Agents): parallel proposer drafts / final
 * candidates. Kept small (2) so latency stays ~flat — the samples run in
 * parallel — while diversity cancels uncorrelated errors. */
const ENSEMBLE_SAMPLES = 2;

function clampDepth(d: number): number {
  return Math.max(1, Math.min(MAX_DEPTH, Math.floor(d)));
}
function clampBreadth(b: number): number {
  return Math.max(1, Math.min(MAX_SAMPLES, Math.floor(b)));
}


// ─────────────────────────────────────────────────────────────────────────────
// v2 — Orchestrated reasoning
// ─────────────────────────────────────────────────────────────────────────────

const sys = (content: string): ApiMessage => ({ role: "system", content });
const usr = (content: string): ApiMessage => ({ role: "user", content });

// The strong model designs the whole answer up front: it fixes the INTENT and
// the task-specific success CRITERIA (so the pipeline can't drift away from what
// was actually asked), then the investigation QUESTIONS. This brief anchors every
// later phase and the verifier's rubric.
const BRIEF = (n: number) =>
  usr(
    "Before any research, act as the lead architect and DESIGN how to answer THIS request well. " +
      "Output exactly these sections:\n" +
      "GOAL: one or two sentences restating the user's true intent — the intended audience, the " +
      "deliverable, and the expected level/format.\n" +
      "CRITERIA: 3-6 bullets defining what a great answer MUST satisfy for THIS specific request " +
      "(audience fit, framing, required depth, format, grounding). Make them concrete and task-" +
      "specific — an answer can be technically correct yet still fail these.\n" +
      "CONSTRAINTS: hard limits the solution must respect — actions/files that must NOT be touched, " +
      "scope boundaries, irreversible operations to avoid, budget/time limits. Write 'none' if there " +
      "are genuinely none. One per line prefixed with '- '.\n" +
      (n > 1
        ? `QUESTIONS: at most ${n} independent, decision-relevant investigation questions whose ` +
          'answers are jointly sufficient to meet the GOAL. One per line, prefixed with "Q: ".'
        : "(Do not list questions for this run.)"),
  );

// Coverage gate: is the gathered evidence enough to meet the brief, or are there gaps?
const SUFFICIENCY = usr(
  "Assess whether the findings above are sufficient to write an answer that fully meets the GOAL " +
    "and CRITERIA. Output ONLY minified JSON: " +
    '{"sufficient": <true|false>, "gaps": ["specific missing fact to investigate", ...]} ' +
    "(gaps = [] when sufficient; list at most 3, most important first).",
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

// LLM-as-judge: scores the draft against a rubric and lists concrete defects.
// Runs as a plain completion (no tools) so the output is clean, parseable JSON.
const JUDGE = usr(
  "You are a strict evaluator. Judge the candidate answer above against the user's task, the " +
    "stated GOAL/CRITERIA, and the gathered evidence. Score 0-100 with this rubric: " +
    "fit to GOAL & CRITERIA 35 (an answer that ignores the task-specific CRITERIA — e.g., wrong " +
    "audience, framing, or format — is a major defect EVEN IF technically correct; violating any " +
    "stated CONSTRAINT is a CRITICAL defect), " +
    "factual grounding & correctness 35 (every concrete claim must be supported by the evidence; " +
    "any unsupported, evidence-contradicting, or internally inconsistent claim is a CRITICAL " +
    "defect that caps the score at 50 — this explicitly includes invented specific numbers/" +
    "counts/versions, citing function/file/library names that do not appear in the evidence " +
    "(treat any code identifier, function name, or library name not seen in the gathered evidence " +
    "as unverified and a defect), and describing a tool or feature as doing something its " +
    "implementation does not), depth/insight appropriate to the audience 20, " +
    "specificity & citations 10. " +
    'Output ONLY minified JSON: {"score": <int 0-100>, "defects": ["concrete issue, most ' +
    'important first", ...]} — use [] when there are no material defects.',
);

const REFINE = (defects: string[], useTools: boolean) =>
  usr(
    "Revise the answer above to fix EVERY issue listed below. Keep what is correct, deepen " +
      "beyond the obvious, and ground claims in the evidence with file:line where useful. " +
      (useTools
        ? "Verify anything you are not certain about with read-only tools (read/grep/list) BEFORE asserting it. "
        : "") +
      "Output ONLY the improved, complete answer — no preamble, no score.\n\nIssues to fix:\n" +
      defects.map((d) => `- ${d}`).join("\n"),
  );

const FINAL = (useTools: boolean) =>
  usr(
    "You are the senior expert delivering the FINAL answer to the user. Before finalizing, " +
      "RE-VERIFY the key claims against the evidence" +
      (useTools ? " (use read-only tools to confirm anything uncertain)" : "") +
      " and correct or remove anything unsupported, evidence-contradicting, or generic. " +
      "The answer MUST satisfy the stated GOAL and CRITERIA (intended audience, framing and " +
      "format) and respect every CONSTRAINT — not merely be technically correct. Then deliver a " +
      "decisive, specific response " +
      "pitched at the right level: ground key claims with file:line evidence, state honest " +
      "uncertainties instead of blanket hedging, no filler or re-stating the question. " +
      "Describe each tool/feature EXACTLY as the evidence shows and do not invent specific " +
      "numbers, counts, versions or capabilities (e.g. an exact count of supported models, or a " +
      "tool that reads files when its implementation does not). Use " +
      "Markdown, code in fenced blocks. Reply in the user's language.",
  );

// Mixture-of-Agents: merge several independent proposer drafts into one.
const AGGREGATE = usr(
  "The candidate drafts above were generated independently. Synthesize them into ONE best draft: " +
    "keep the correct and insightful parts, discard errors, unsupported claims and contradictions, " +
    "and satisfy the GOAL/CRITERIA. Output ONLY the merged draft.",
);

// best-of-N selection by the strong model acting as verifier.
const SELECT = usr(
  "The candidate FINAL answers above were generated independently. Acting as a strict verifier, " +
    "output the single best answer: choose the strongest, then improve it by folding in any " +
    "superior, well-grounded points from the others and removing anything unsupported, off-brief, " +
    "or that violates a CONSTRAINT. The result MUST satisfy the GOAL/CRITERIA. Describe tools/" +
    "features exactly as the evidence shows; invent no specific numbers or capabilities. Output " +
    "ONLY the final answer (Markdown, in the user's language).",
);

/** Parse the judge's JSON verdict; tolerant of stray prose around the JSON. */
function parseJudgment(text: string): { score: number; defects: string[] } {
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]) as { score?: unknown; defects?: unknown };
      const score = Math.max(0, Math.min(100, Math.round(Number(o.score))));
      const defects = Array.isArray(o.defects) ? o.defects.map(String).filter(Boolean) : [];
      if (Number.isFinite(score)) return { score, defects };
    } catch {
      /* fall through to heuristic */
    }
  }
  const sm = text.match(/score[^0-9]*(\d{1,3})/i);
  const score = sm ? Math.max(0, Math.min(100, Number(sm[1]))) : 60;
  return { score, defects: score >= 85 ? [] : ["（評価の解析に失敗。改善を継続）"] };
}

function parseBrief(
  text: string,
  maxQ: number,
): { goal: string; criteria: string[]; constraints: string[]; questions: string[] } {
  const goalM = text.match(/GOAL[:：]\s*([\s\S]*?)(?:\n\s*(?:CRITERIA|CONSTRAINTS|QUESTIONS|評価基準)\b|$)/i);
  const goal = goalM ? goalM[1].trim().replace(/\s*\n+\s*/g, " ") : "";
  const bullets = (section: string): string[] =>
    section
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*[-*•\d.)]+\s*/, "").trim())
      .filter((l) => l.length > 1)
      .slice(0, 8);
  const critM = text.match(/CRITERIA[:：]?\s*([\s\S]*?)(?:\n\s*(?:CONSTRAINTS|QUESTIONS)\b|$)/i);
  const criteria = critM ? bullets(critM[1]) : [];
  const consM = text.match(/CONSTRAINTS[:：]?\s*([\s\S]*?)(?:\n\s*QUESTIONS\b|$)/i);
  const constraints = consM
    ? bullets(consM[1]).filter((c) => !/^none\b|^なし$/i.test(c))
    : [];
  return { goal, criteria, constraints, questions: parseQuestions(text, maxQ) };
}

function parseSufficiency(text: string): { sufficient: boolean; gaps: string[] } {
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]) as { sufficient?: unknown; gaps?: unknown };
      const gaps = Array.isArray(o.gaps) ? o.gaps.map(String).filter(Boolean).slice(0, 3) : [];
      return { sufficient: o.sufficient === true, gaps };
    } catch {
      /* fall through */
    }
  }
  return { sufficient: true, gaps: [] }; // unparseable → don't block
}

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

export async function runRecurrentReasoning(
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
  // Spend the extra ensemble passes only when the task is non-trivial (the user
  // asked for breadth or depth); simple runs stay single-pass and fast.
  const ensemble = (opts.ensemble ?? true) && (breadth > 1 || depth >= 3);

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

  // ── Phase A — Solution brief (strong model designs intent + criteria + plan) ─
  const briefText = await think([...base, BRIEF(breadth)], synthesis, { tools: false });
  if (aborted()) return;
  const brief = parseBrief(briefText, breadth);
  cb.onThought("設計（ブリーフ）", synthLabel, briefText);
  // The brief anchors every later phase: investigation, the verifier's rubric,
  // and the final answer are all held accountable to this GOAL/CRITERIA.
  const briefMsgs: ApiMessage[] =
    brief.goal || brief.criteria.length || brief.constraints.length
      ? [
          sys(
            "このタスクの設計（最終回答は必ずこれを満たすこと）:\n" +
              (brief.goal ? `GOAL: ${brief.goal}\n` : "") +
              (brief.criteria.length
                ? "CRITERIA:\n" + brief.criteria.map((c) => `- ${c}`).join("\n") + "\n"
                : "") +
              (brief.constraints.length
                ? "CONSTRAINTS（厳守。違反は不可）:\n" +
                  brief.constraints.map((c) => `- ${c}`).join("\n")
                : ""),
          ),
        ]
      : [];

  // ── Phase B — Investigation (cheap model, read-only, grounded) ──────────────
  const investigate = async (q: string, label: string): Promise<string> => {
    const r = await think([...base, ...briefMsgs, INVESTIGATOR, usr(`Sub-question: ${q}`)], thinking, {
      readOnly: true,
    });
    cb.onThought(label, thinkingLabel, r);
    return `### 調査: ${q}\n${r}`;
  };

  let evidence = "";
  if (breadth > 1 && brief.questions.length >= 2) {
    const qs = brief.questions;
    // Always parallel — investigations are read-only and independent, so this
    // cuts latency from sum-of-questions to the slowest one. (Tool cards from
    // concurrent agents may interleave; that's cosmetic.)
    const findings = await Promise.all(
      qs.map((q, i) => investigate(q, `調査 ${i + 1}/${qs.length}`)),
    );
    if (aborted()) return;

    // ── Phase B2 — Sufficiency gate: fill evidence gaps once before concluding ──
    const provisional = clip(findings.join("\n\n"), MAX_EVIDENCE_CHARS);
    const suffText = await think(
      [...base, ...briefMsgs, sys(`収集された調査結果:\n\n${provisional}`), SUFFICIENCY],
      thinking,
      { tools: false },
    );
    if (aborted()) return;
    const { sufficient, gaps } = parseSufficiency(suffText);
    cb.onThought(
      "十分性チェック",
      thinkingLabel,
      sufficient || gaps.length === 0
        ? "証拠は十分と判断"
        : "不足あり、追加調査します:\n" + gaps.map((g) => `- ${g}`).join("\n"),
    );
    if (!sufficient && gaps.length > 0) {
      for (let i = 0; i < gaps.length; i++) {
        if (aborted()) return;
        findings.push(await investigate(gaps[i], `追加調査 ${i + 1}/${gaps.length}`));
      }
    }
    evidence = clip(findings.join("\n\n"), MAX_EVIDENCE_CHARS);
  }

  // ── Phase C — Draft against the brief, grounded in the evidence ─────────────
  // Cost routing: the draft is the most expensive single generation, so it runs
  // on the CHEAP thinking model. The strong model is reserved for the final
  // synthesis (and for verifier escalations), which keeps quality while cutting
  // the expensive calls from 3 → ~1.
  const evidenceMsgs: ApiMessage[] = evidence
    ? [sys(`収集された調査結果（根拠。以後の判断はこれを優先）:\n\n${evidence}`)]
    : [];
  const ctx = [...briefMsgs, ...evidenceMsgs];
  const draftInstr = evidence ? DRAFT_FROM_EVIDENCE : DRAFT_PLAIN;
  let draft: string;
  if (ensemble) {
    // Mixture-of-Agents: several independent drafts (parallel, plain) → merge.
    const proposals = await Promise.all(
      Array.from({ length: ENSEMBLE_SAMPLES }, () =>
        think([...base, ...ctx, draftInstr], thinking, { tools: false }),
      ),
    );
    if (aborted()) return;
    proposals.forEach((p, i) =>
      cb.onThought(`ドラフト案 ${i + 1}/${ENSEMBLE_SAMPLES}`, thinkingLabel, p),
    );
    const merged = [
      ...base,
      ...ctx,
      sys(
        "以下は独立に生成した候補ドラフトです:\n\n" +
          proposals.map((p, i) => `### 案 ${i + 1}\n${p}`).join("\n\n"),
      ),
      AGGREGATE,
    ];
    draft = await think(merged, thinking, { tools: false });
    cb.onThought("ドラフト統合（MoA）", thinkingLabel, draft);
  } else {
    draft = await think([...base, ...ctx, draftInstr], thinking, { readOnly: true });
    cb.onThought(evidence ? "統合ドラフト" : "初期ドラフト", thinkingLabel, draft);
  }
  if (aborted()) return;

  // ── Phase D — Verifier-guided refine (judge against the brief; adaptive) ────
  // An independent judge scores the draft against the GOAL/CRITERIA each round;
  // we stop early once it passes (real signal, not a self-claim), and escalate
  // refinement to the strong model when the cheap model is stuck on a low score.
  for (let k = 1; k <= depth; k++) {
    if (aborted()) return;
    const verdict = await think(
      [...base, ...ctx, { role: "assistant", content: draft }, JUDGE],
      thinking,
      { tools: false },
    );
    const { score, defects } = parseJudgment(verdict);
    cb.onThought(
      `検証 ${k}/${depth}（スコア ${score}）`,
      thinkingLabel,
      defects.length ? defects.map((d) => `- ${d}`).join("\n") : "重大な指摘なし",
    );
    if (score >= PASS_SCORE || defects.length === 0) break;
    if (aborted()) return;

    const escalate = k >= Math.ceil(depth / 2) && score < ESCALATE_BELOW;
    const refineModel = escalate ? synthesis : thinking;
    draft = await think(
      [...base, ...ctx, { role: "assistant", content: draft }, REFINE(defects, opts.useTools)],
      refineModel,
      { readOnly: true },
    );
    cb.onThought(
      `改善 ${k}/${depth}${escalate ? "（強モデルへ昇格）" : ""}`,
      escalate ? synthLabel : thinkingLabel,
      draft,
    );
  }
  if (aborted()) return;

  // ── Phase E — Final (strong model). On non-trivial tasks: best-of-N with the
  // strong model selecting/merging the best candidate (verifier selection). ────
  if (ensemble) {
    const candidates = await Promise.all(
      Array.from({ length: ENSEMBLE_SAMPLES }, () =>
        think([...base, ...ctx, { role: "assistant", content: draft }, FINAL(false)], synthesis, {
          tools: false,
        }),
      ),
    );
    if (aborted()) return;
    candidates.forEach((c, i) =>
      cb.onThought(`最終候補 ${i + 1}/${ENSEMBLE_SAMPLES}`, synthLabel, c),
    );
    const final = await think(
      [
        ...base,
        ...ctx,
        sys(
          "以下は独立に生成した最終回答の候補です:\n\n" +
            candidates.map((c, i) => `### 候補 ${i + 1}\n${c}`).join("\n\n"),
        ),
        SELECT,
      ],
      synthesis,
      { tools: false },
    );
    cb.onFinal(final);
  } else {
    const final = await think(
      [...base, ...ctx, { role: "assistant", content: draft }, FINAL(opts.useTools)],
      synthesis,
      { readOnly: true },
    );
    cb.onFinal(final);
  }
}
