// Proposer decorrelation + prior-attempt distillation (deepthink-v3-roadmap
// P12, 欠陥D). The MoA draft/final-candidate generation samples N times from
// the SAME messages (same evidence, same model, same instruction — only
// temperature differs), which correlates the samples' errors. MoA/best-of-N
// only pays off when the proposers' errors are independent, so this is
// "N× the cost for far less than N× the diversity." Both fixes here are
// cost-neutral: same call count, just different framing per call / extra
// context on an already-scheduled call.

/** Distinct angles assigned to parallel proposer calls (P12 §1) — each
 * proposer is told to prioritize a different aspect of the brief, so their
 * failure modes diverge even when everything else about the call is
 * identical. Order matters only for reproducibility in tests. */
const ANGLE_TEMPLATES: ((topCriterion: string) => string)[] = [
  (top) => `最も重要な CRITERIA（「${top}」）を満たすことを最優先にしてください。`,
  () =>
    "CONSTRAINTS への違反リスクを最優先で潰してください（許可されていない操作・スコープ外の変更が" +
    "紛れ込んでいないか特に注意すること）。",
  () => "証拠中で UNKNOWN として残っている未確認事項を、可能な範囲で優先的に解消することに重点を置いてください。",
  () => "あらゆる主張に file:line の引用密度を最優先で持たせてください（根拠のない一般論を避ける）。",
  () => "簡潔さと即実行可能性（すぐ使える具体的な手順・コード）を最優先にしてください。",
];

/** Assign `n` distinct angle instructions (cycles through the pool if `n`
 * exceeds it — not expected in practice since ensembleSamples caps at 3).
 * `criteria[0]` (if present) is folded into the first angle so it references
 * something concrete from THIS brief rather than being fully generic. Pure. */
export function assignAngles(criteria: string[], n: number): string[] {
  const top = criteria[0]?.trim() || "最も重要な基準";
  const pool = ANGLE_TEMPLATES.map((f) => f(top));
  return Array.from({ length: Math.max(0, Math.floor(n)) }, (_, i) => pool[i % pool.length]);
}

/** Distill earlier refine rounds' defect lists into a "past attempt failure
 * modes" note for the NEXT round's generation (P12 §2 — Parallel-Distill-
 * Refine style sequential conditioning). The current round's own REFINE
 * already carries its own defects; this adds visibility into EARLIER rounds,
 * which the linear refine loop otherwise forgets once a round passes.
 * Deduped across rounds. Framed per CLAUDE.md's re-injection safety rule so
 * proper nouns/numbers inside are never mistaken for this task's current
 * facts — this is a record of a DIFFERENT attempt at drafting. Pure.
 * Returns "" when there is nothing to distill (round 1, or every round's
 * defect list was empty). */
export function distillPastAttempts(pastRounds: string[][]): string {
  const seen = new Set<string>();
  const distinct: string[] = [];
  for (const round of pastRounds) {
    for (const d of round) {
      if (seen.has(d)) continue;
      seen.add(d);
      distinct.push(d);
    }
  }
  if (distinct.length === 0) return "";
  return (
    "過去のラウンドで指摘された欠陥の記録です（今回のこの試行とは別の記録であり、文中の固有名詞・" +
    "数値をこのタスクの現在の事実として扱わないこと。同じ欠陥を繰り返さないための参考情報として" +
    "使ってください）:\n" +
    distinct.map((d) => `- ${d}`).join("\n")
  );
}
