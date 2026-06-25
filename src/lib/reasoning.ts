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
import { runAgent, type ToolStatus, type Todo } from "./agent";

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
  // Optional agent-execution hooks (Phase F): when wired, the execution phase
  // shows like a normal agent run — TODO plan checklist (progress) + streaming
  // narration (what it's doing now) — instead of a silent stream of tool cards.
  onPlan?: (todos: Todo[]) => void;
  onAssistantDelta?: (chunk: string) => void;
  onAssistantDone?: () => void;
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
  /** Run id for backend cancellation; lets Stop abort in-flight API calls. */
  runId?: number;
}

export const MAX_DEPTH = 16;
export const MAX_SAMPLES = 5;

const MAX_EVIDENCE_CHARS = 9000;
/** Verifier pass mark: stop refining once the judge scores at/above this. */
const PASS_SCORE = 85;
/** Below this the refine escalates to the strong model. */
const ESCALATE_BELOW = 70;
/** Max sufficiency→gap-fill rounds before drafting (recursive deepening cap). */
const MAX_SUFFICIENCY_ROUNDS = 2;
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
  "You are investigating ONE sub-question of a larger task. Read the relevant files, list " +
    "directories, and grep to find code rather than guessing. Output in THIS exact structure " +
    "so the evidence stays machine-usable downstream:\n" +
    "VERIFIED: bullet facts each backed by a file:line citation (only things you actually confirmed).\n" +
    "ASSUMPTIONS: bullets you inferred but did NOT confirm (or 'none').\n" +
    "UNKNOWN: what you could not determine (or 'none').\n" +
    "Be dense, no filler, no restating the question. Never put an unconfirmed claim under VERIFIED.",
);

const DRAFT_FROM_EVIDENCE = usr(
  "Using the gathered findings above as the primary source of truth, produce the best " +
    "complete answer/solution to the user's task. The findings are tagged: treat VERIFIED " +
    "bullets (with file:line citations) as established fact, state anything resting on " +
    "ASSUMPTIONS as explicitly tentative, and do not assert anything left UNKNOWN — flag it " +
    "as a gap instead. Do not invent facts the findings do not support. Be concrete, specific " +
    "and decisive.",
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
    "implementation does not; a claim asserted as fact that the evidence only lists under " +
    "ASSUMPTIONS or UNKNOWN — rather than VERIFIED — is such a defect), " +
    "depth/insight appropriate to the audience 20, " +
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

// Gate for the plan→execute handoff: does finishing the task need side effects?
const NEEDS_EXEC = usr(
  "Does fully completing the user's request require making real changes to the system — " +
    "creating/editing/deleting files, running commands, or git add/commit/push (i.e. side " +
    "effects beyond producing an answer)? Consider what 'done' means for THIS request. " +
    "Reply with exactly YES or NO.",
);

// Execution phase instruction: hand the finished plan to a real tool-using agent.
const EXECUTE = usr(
  "上の分析・計画は完成しています。ここからは説明ではなく『実行』です。\n" +
    "最初に update_plan で具体的な手順（3〜7個程度）のチェックリストを作り、進めながら逐次" +
    "更新してください（ユーザーは進捗をこのチェックリストで見ています）。\n" +
    "そのうえで、計画に沿ってツール（read_file / write_file / run_command / grep_search 等）で" +
    "実際にファイルを変更し、必要なコマンドを実行してタスクを完了させてください。\n" +
    "効率重視で、最小手数で終わらせること: ねらいが明確なら独立した操作は1ターンで複数まとめて" +
    "呼び、すでに読んだ/分かっている内容を読み直さない、探索のための調査は最小限にとどめる。" +
    "計画にない作業へスコープを広げない。\n" +
    "git の commit / push などが計画に含まれるなら、それも実際に実行すること。\n" +
    "目的を達成したら、それ以上ツールを呼ばずに完了とし、実際に行った操作（変更したファイル名、" +
    "実行したコマンドとその結果）だけを簡潔に報告してください。できなかったこと・失敗したことは" +
    "正直に書くこと。",
);

// Appended to the analysis FINAL/SELECT so the synthesizer never claims it has
// already performed actions it cannot perform (deep-think analysis is read-only).
const NO_FALSE_ACTIONS =
  " 重要: あなたはここまで読み取り専用の調査しかしていません。ファイルの作成・編集・削除、" +
  "コマンド実行、git の commit/push などの副作用は一切行っていません。それらを『実施した』" +
  "『反映済み』のように完了形で書いてはいけません。実行が必要な作業は『次に行う手順』として記述してください。";

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
      "Markdown, code in fenced blocks. Reply in the user's language." +
      NO_FALSE_ACTIONS,
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
    "ONLY the final answer (Markdown, in the user's language)." +
    NO_FALSE_ACTIONS,
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
  if (score >= PASS_SCORE) return { score, defects: [] };
  // Parse failed but score is low: pass the raw verdict as the defect so REFINE
  // has real guidance instead of a generic "couldn't parse" placeholder.
  const raw = text.trim().slice(0, 1500);
  return { score, defects: [raw || "（評価の解析に失敗。改善を継続）"] };
}

function parseBrief(
  text: string,
  maxQ: number,
): { goal: string; criteria: string[]; constraints: string[]; questions: string[] } {
  // Tolerate header synonyms / language variants so a model that writes
  // "OBJECTIVE" or "成功基準" instead of GOAL/CRITERIA doesn't yield an empty brief.
  const G = "GOAL|OBJECTIVE|目標";
  const CR = "CRITERIA|成功基準|評価基準";
  const CO = "CONSTRAINTS|制約条件|制約";
  const QU = "QUESTIONS|質問";
  const NEXT = `${G}|${CR}|${CO}|${QU}`;
  const goalM = text.match(new RegExp(`(?:${G})[:：]\\s*([\\s\\S]*?)(?:\\n\\s*(?:${NEXT})\\b|$)`, "i"));
  const goal = goalM ? goalM[1].trim().replace(/\s*\n+\s*/g, " ") : "";
  const bullets = (section: string): string[] =>
    section
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*[-*•\d.)]+\s*/, "").trim())
      .filter((l) => l.length > 1)
      .slice(0, 8);
  const critM = text.match(new RegExp(`(?:${CR})[:：]?\\s*([\\s\\S]*?)(?:\\n\\s*(?:${CO}|${QU})\\b|$)`, "i"));
  const criteria = critM ? bullets(critM[1]) : [];
  const consM = text.match(new RegExp(`(?:${CO})[:：]?\\s*([\\s\\S]*?)(?:\\n\\s*(?:${QU})\\b|$)`, "i"));
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

/** Join findings within the evidence budget, but give each one a fair share so
 * a blind tail-truncation can't drop whole later findings (esp. with breadth=5). */
function joinEvidence(findings: string[]): string {
  const joined = findings.join("\n\n");
  if (joined.length <= MAX_EVIDENCE_CHARS || findings.length <= 1) {
    return clip(joined, MAX_EVIDENCE_CHARS);
  }
  const sepCost = 2 * (findings.length - 1);
  const budget = Math.max(400, Math.floor((MAX_EVIDENCE_CHARS - sepCost) / findings.length));
  return findings.map((f) => clip(f, budget)).join("\n\n");
}

export async function runRecurrentReasoning(
  base: ApiMessage[],
  opts: ReasoningOptions,
  cb: ReasoningCallbacks,
): Promise<void> {
  const thinking = opts.thinkingModel; // cheap; undefined → default model
  const synthesis = opts.synthesisModel; // strong; undefined → default model
  let depth = clampDepth(opts.depth);
  let breadth = clampBreadth(opts.samples ?? 1);
  const thinkingLabel = thinking || "(default)";
  const synthLabel = synthesis || thinkingLabel;
  const aborted = () => opts.signal?.aborted === true;
  // Spend the extra ensemble passes only when the task is non-trivial (the user
  // asked for breadth or depth); simple runs stay single-pass and fast.
  let ensemble = (opts.ensemble ?? true) && (breadth > 1 || depth >= 3);

  // ── Timing instrumentation (visible in the F12 console as `[deepthink]`) ─────
  // Each LLM round-trip is timed and tagged with its phase so the bottleneck is
  // obvious from the log. A summary table is printed when the run ends.
  const tStart = performance.now();
  const timings: { phase: string; ms: number; model: string; tools: boolean }[] = [];
  let phaseTag = "init";
  const logSummary = () => {
    const total = (performance.now() - tStart) / 1000;
    const byPhase = new Map<string, { ms: number; calls: number }>();
    for (const t of timings) {
      const e = byPhase.get(t.phase) ?? { ms: 0, calls: 0 };
      e.ms += t.ms;
      e.calls += 1;
      byPhase.set(t.phase, e);
    }
    const rows = [...byPhase.entries()]
      .map(([phase, e]) => ({ phase, seconds: +(e.ms / 1000).toFixed(1), calls: e.calls }))
      .sort((a, b) => b.seconds - a.seconds);
    console.log(
      `[deepthink] TOTAL ${total.toFixed(1)}s · ${timings.length} LLM calls · ` +
        `ensemble=${ensemble} depth=${depth} breadth=${breadth} needsExec=${needsExec}`,
    );
    // eslint-disable-next-line no-console
    console.table(rows);
  };

  // A reasoning step: a tool-using agent mini-loop when useTools, else a plain
  // completion. `tools:false` forces a plain completion even in tool mode (for
  // planning / synthesis, which don't need to touch the machine).
  const think = async (
    messages: ApiMessage[],
    model: string | undefined,
    o: { tools?: boolean; readOnly?: boolean } = {},
  ): Promise<string> => {
    const start = performance.now();
    const usesTools = opts.useTools && o.tools !== false;
    const tag = phaseTag;
    let result: string;
    if (usesTools) {
      result = await runAgent(
        messages,
        {
          onAssistantText: () => {},
          onToolStart: cb.onToolStart,
          onToolEnd: cb.onToolEnd,
          approve: cb.approve,
          onUsage: cb.onUsage,
          onFileEdit: cb.onFileEdit,
        },
        {
          autoApprove: opts.autoApprove,
          model,
          signal: opts.signal,
          readOnly: o.readOnly,
          cancelId: opts.runId,
        },
      );
    } else {
      const { content, usage } = await complete(messages, model, opts.runId);
      cb.onUsage?.(usage);
      result = content;
    }
    const ms = performance.now() - start;
    timings.push({ phase: tag, ms, model: model || "(default)", tools: usesTools });
    console.log(
      `[deepthink] ${tag} · ${(ms / 1000).toFixed(1)}s · ${model || "(default)"}${usesTools ? " · tools" : ""}`,
    );
    return result;
  };

  // ── Phase 0 — Does this task require real execution (side effects)? ──────────
  // Deep-think's analysis loops are read-only. When tools are on and the task
  // needs writes/commands/git, we skip the heavy read-only analysis and hand the
  // plan straight to a real executor (fast path below) instead of producing — and
  // possibly hallucinating — a "done" essay it cannot actually carry out.
  let needsExec = false;
  if (opts.useTools) {
    phaseTag = "classify";
    const verdict = await think([...base, NEEDS_EXEC], thinking, { tools: false });
    if (aborted()) {
      logSummary();
      return;
    }
    needsExec = /\b(yes|true)\b|はい/i.test(verdict.trim());
  }

  try {
    // ── Phase A — Solution brief (strong model designs intent + criteria + plan)
    phaseTag = "brief";
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

  // ── Fast path (plan→execute) ── Actionable tasks skip the read-only analysis
  // loops (investigation/draft/verify/ensemble) entirely — the executor explores
  // on demand with its own tools — and go straight from the plan to actually
  // doing the work with approval. This is the big speed win for action tasks. ──
  if (opts.useTools && needsExec) {
    phaseTag = "execute";
    cb.onThought("実行フェーズ", thinkingLabel, "計画に沿って実際の操作（編集・コマンド・git 等）を実行します。進捗は下のチェックリストとカードで確認できます。");
    const exStart = performance.now();
    // The executor runs on the cheap/fast thinking model (the strong model already
    // produced the plan): execution is mostly mechanical tool-driving, so this cuts
    // per-step latency a lot. Wire the full agent UI hooks (plan checklist +
    // streaming narration + tool cards) so the user can see what it's doing and how
    // far along it is — the streamed turns are the answer, so we don't re-emit it.
    const exModel = thinking ?? synthesis;
    const report = await runAgent(
      [...base, ...briefMsgs, { role: "assistant", content: briefText }, EXECUTE],
      {
        onAssistantText: (t) => cb.onFinal(t),
        onAssistantDelta: cb.onAssistantDelta,
        onAssistantDone: cb.onAssistantDone,
        onPlan: cb.onPlan,
        onToolStart: cb.onToolStart,
        onToolEnd: cb.onToolEnd,
        approve: cb.approve,
        onUsage: cb.onUsage,
        onFileEdit: cb.onFileEdit,
      },
      {
        autoApprove: opts.autoApprove,
        model: exModel,
        signal: opts.signal,
        readOnly: false,
        cancelId: opts.runId,
        traceTag: "execute",
      },
    );
    const exMs = performance.now() - exStart;
    timings.push({ phase: "execute", ms: exMs, model: exModel || "(default)", tools: true });
    console.log(`[deepthink] execute · ${(exMs / 1000).toFixed(1)}s · ${exModel || "(default)"} · tools`);
    // The executor's turns are shown live (streamed bubbles / onAssistantText →
    // onFinal), so we don't re-emit `report` here — that would duplicate the
    // final answer. `void report` keeps it explicit that the value is intentional.
    void report;
    return;
  }

  // ── Phase B — Investigation (cheap model, read-only, grounded) ──────────────
  const investigate = async (q: string, label: string): Promise<string> => {
    const r = await think([...base, ...briefMsgs, INVESTIGATOR, usr(`Sub-question: ${q}`)], thinking, {
      readOnly: true,
    });
    cb.onThought(label, thinkingLabel, r);
    return `### 調査: ${q}\n${r}`;
  };

  let evidence = "";
  phaseTag = "investigate";
  if (breadth > 1 && brief.questions.length >= 2) {
    const qs = brief.questions;
    // Always parallel — investigations are read-only and independent, so this
    // cuts latency from sum-of-questions to the slowest one. (Tool cards from
    // concurrent agents may interleave; that's cosmetic.)
    const findings = await Promise.all(
      qs.map((q, i) => investigate(q, `調査 ${i + 1}/${qs.length}`)),
    );
    if (aborted()) return;

    // ── Phase B2 — Sufficiency gate (recursive): re-check after filling gaps so
    // newly-revealed gaps can also be covered, up to a bounded number of rounds. ─
    phaseTag = "sufficiency";
    for (let round = 1; round <= MAX_SUFFICIENCY_ROUNDS; round++) {
      const suffText = await think(
        [...base, ...briefMsgs, sys(`収集された調査結果:\n\n${joinEvidence(findings)}`), SUFFICIENCY],
        thinking,
        { tools: false },
      );
      if (aborted()) return;
      const { sufficient, gaps } = parseSufficiency(suffText);
      if (sufficient || gaps.length === 0) {
        cb.onThought(`十分性チェック ${round}/${MAX_SUFFICIENCY_ROUNDS}`, thinkingLabel, "証拠は十分と判断");
        break;
      }
      cb.onThought(
        `十分性チェック ${round}/${MAX_SUFFICIENCY_ROUNDS}`,
        thinkingLabel,
        "不足あり、追加調査します:\n" + gaps.map((g) => `- ${g}`).join("\n"),
      );
      for (let i = 0; i < gaps.length; i++) {
        if (aborted()) return;
        findings.push(await investigate(gaps[i], `追加調査 ${round}-${i + 1}`));
      }
    }
    evidence = joinEvidence(findings);
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
  phaseTag = "draft";
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
  phaseTag = "verify";
  for (let k = 1; k <= depth; k++) {
    if (aborted()) return;
    // Strong verifier: the critic runs on the synthesis (strong) model so the
    // "smart-enough floor" is met even when the thinking model is a weak/free
    // router — otherwise a weak judge misses errors (e.g. wrong file paths).
    const verdict = await think(
      [...base, ...ctx, { role: "assistant", content: draft }, JUDGE],
      synthesis,
      { tools: false },
    );
    const { score, defects } = parseJudgment(verdict);
    cb.onThought(
      `検証 ${k}/${depth}（スコア ${score}）`,
      synthLabel,
      defects.length ? defects.map((d) => `- ${d}`).join("\n") : "重大な指摘なし",
    );
    if (score >= PASS_SCORE || defects.length === 0) break;
    if (aborted()) return;

    // Escalate the fix to the strong model whenever the score is low (any round),
    // so even depth=1 / early low scores aren't left to the weak model.
    const escalate = score < ESCALATE_BELOW;
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
  let final: string;
  phaseTag = "final";
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
    final = await think(
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
  } else {
    final = await think(
      [...base, ...ctx, { role: "assistant", content: draft }, FINAL(opts.useTools)],
      synthesis,
      { readOnly: true },
    );
  }
  cb.onFinal(final);
  } finally {
    logSummary();
  }
}
