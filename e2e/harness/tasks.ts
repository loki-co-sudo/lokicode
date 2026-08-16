// Fixed task set for the deterministic evaluation harness (deepthink-v3-roadmap
// P8). Every task targets THIS repository's own source, so the citations
// grader has real files to check against and the tasks stay reproducible
// without needing a disposable sandbox workspace.
//
// All tasks currently use the "deep" (read-only analysis) route: the harness's
// filesystem shim (`../tauriShim.ts`) does not yet allow write_text_file /
// run_command, so edits/exit/forbidden-graded execute-route tasks are deferred
// to P10, which adds a sandboxed workspace for execution-path verification
// (see specs/deepthink-v3-roadmap.md P10). The `edits`/`exit`/`forbidden`
// graders themselves already exist and are unit-tested (`src/lib/graders.ts`)
// — only the harness wiring to exercise them is pending.

export type GraderSpec =
  | { kind: "citations" }
  | { kind: "calls" };

export interface Task {
  id: string;
  /** What the task is measuring (documents intent; not machine-checked). */
  note: string;
  prompt: string;
  route: "deep";
  depth: number;
  samples: number;
  effort: "speed" | "balanced" | "quality";
  /** Solve-level decomposition (P3). */
  decompose?: boolean;
  /** Defect-guided beam search (P6) — only meaningful with effort "quality". */
  beamSearch?: boolean;
  graders: GraderSpec[];
}

export const TASKS: Task[] = [
  {
    id: "reasoning-verify-loop",
    note: "P2 repo-map grounding + citations grader baseline (balanced, breadth 2)",
    prompt:
      "このリポジトリのディープシンク（src/lib/reasoning.ts）の検証フェーズについて、" +
      "(1) 早期終了する条件 (2) 改善が強モデルへ昇格する条件 を、根拠となる file:line の引用つきで正確に説明してください。",
    route: "deep",
    depth: 2,
    samples: 2,
    effort: "balanced",
    graders: [{ kind: "citations" }, { kind: "calls" }],
  },
  {
    id: "agent-approval-levels",
    note: "citations grader against src/lib/agent.ts; single-question run (breadth 1)",
    prompt:
      "このリポジトリのエージェントの承認レベル『standard』では、どの操作が自動承認され、" +
      "どの操作が確認（承認待ち）になりますか？根拠となる file:line の引用つきで整理してください。",
    route: "deep",
    depth: 2,
    samples: 1,
    effort: "balanced",
    graders: [{ kind: "citations" }, { kind: "calls" }],
  },
  {
    id: "cost-pipeline-shape",
    note: "P4 (evidence cache exercised on repeat runs) + citations grader on src/lib/cost.ts",
    prompt:
      "src/lib/cost.ts の pipelineShape() が数える強モデル呼び出しと安価モデル呼び出しの内訳を、" +
      "depth と judgeSamples がそれぞれどう影響するか、file:line の引用つきで説明してください。",
    route: "deep",
    depth: 2,
    samples: 2,
    effort: "balanced",
    graders: [{ kind: "citations" }, { kind: "calls" }],
  },
  {
    id: "quality-ensemble-width",
    note: "quality effort: ensemble width 3, judgeSamples 2 — exercises the effort preset lever",
    prompt:
      "このリポジトリの effort プリセット（speed/balanced/quality）は ensembleSamples と " +
      "judgeSamples をそれぞれどう変えますか？file:line の引用つきで整理してください。",
    route: "deep",
    depth: 2,
    samples: 1,
    effort: "quality",
    graders: [{ kind: "citations" }, { kind: "calls" }],
  },
  {
    id: "defect-memory-p5",
    note: "P5 defect memory: citations grader against src/lib/defectMemory.ts",
    prompt:
      "src/lib/defectMemory.ts の欠陥メモリは、記録された欠陥をどのフェーズにだけ注入し、" +
      "どのフェーズには注入しませんか（理由も）？file:line の引用つきで説明してください。",
    route: "deep",
    depth: 2,
    samples: 1,
    effort: "balanced",
    graders: [{ kind: "citations" }, { kind: "calls" }],
  },
  {
    id: "beam-search-p6",
    note: "P6 defect-guided beam: quality effort + beamSearch, citations grader on the beam block",
    prompt:
      "src/lib/reasoning.ts の欠陥誘導ビームサーチ（P6）は、どういう条件で発火し、幅はいくつで、" +
      "何回まで発火しますか？file:line の引用つきで説明してください。",
    route: "deep",
    depth: 4,
    samples: 1,
    effort: "quality",
    beamSearch: true,
    graders: [{ kind: "citations" }, { kind: "calls" }],
  },
];
