// Criteria-decomposed JUDGE parsing (deepthink-v3-roadmap P13 §1-2). The old
// JUDGE returned a single 0-100 score, so (a) REFINE only ever got "fix
// everything" instead of a focused instruction, and (b) score noise across
// `judgeSamples` parallel judges could only be collapsed with min() — real
// per-criterion variance was thrown away. This module gives the JUDGE a
// criteria-keyed output while keeping backward compatibility with the old
// single-score format (a model that doesn't comply, or a brief with no
// parsed CRITERIA, still produces a usable Judgment).
//
// The strong-model JUDGE remains the ONLY thing that can grant a pass — this
// module only changes the SHAPE of its output and how REFINE is focused, per
// CLAUDE.md「判定器を安価モデルに下げない」.

/** Fallback verifier pass mark used only by the unparseable-JSON heuristic
 * branch below (mirrors the old single-score fallback). The effort preset's
 * `passScore` — read by reasoning.ts — is the real gate; this only decides
 * whether an unparseable verdict should be treated as a probable pass. */
export const FALLBACK_PASS_SCORE = 85;

/** A CRITICAL defect (per the JUDGE prompt's rule) caps the OVERALL score,
 * not just the offending criterion — a single critical defect must not wash
 * out to a near-passing mean once averaged across many criteria. */
const CRITICAL_CAP = 50;

export interface CriterionDefect {
  /** Criterion key ("c1", "c2", ...) as listed in the JUDGE prompt, or "" if
   * the model didn't attach one (still kept — see the old-string-defect path). */
  criterion: string;
  issue: string;
  critical: boolean;
}

export interface Judgment {
  /** Overall 0-100 score (computed from per-criterion scores, or given
   * directly in the old single-score format). */
  score: number;
  /** Flat defect strings — for display, defect-memory recording (P5), and as
   * the fallback input to REFINE when there's no per-criterion breakdown. */
  defects: string[];
  /** Per-criterion 0-10 scores, present only when the JUDGE used the new
   * criteria-decomposed format. */
  criteriaScores?: Record<string, number>;
  criteriaDefects?: CriterionDefect[];
}

function parseCriterionDefect(d: unknown): CriterionDefect | null {
  if (d && typeof d === "object") {
    const dd = d as { criterion?: unknown; issue?: unknown; critical?: unknown };
    const issue = String(dd.issue ?? "").trim();
    if (!issue) return null;
    return { criterion: String(dd.criterion ?? "").trim(), issue, critical: dd.critical === true };
  }
  const issue = String(d).trim();
  return issue ? { criterion: "", issue, critical: false } : null;
}

/** Parse the JUDGE's JSON verdict; tolerant of stray prose around the JSON
 * and of the old single-score format (backward compatible). */
export function parseJudgment(text: string): Judgment {
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]) as { score?: unknown; scores?: unknown; defects?: unknown };
      // New criteria-decomposed format.
      if (o.scores && typeof o.scores === "object" && !Array.isArray(o.scores)) {
        const criteriaScores: Record<string, number> = {};
        for (const [k, v] of Object.entries(o.scores as Record<string, unknown>)) {
          const n = Number(v);
          if (Number.isFinite(n)) criteriaScores[k] = Math.max(0, Math.min(10, n));
        }
        const values = Object.values(criteriaScores);
        if (values.length > 0) {
          const criteriaDefects = Array.isArray(o.defects)
            ? o.defects.map(parseCriterionDefect).filter((d): d is CriterionDefect => d !== null)
            : [];
          const mean = values.reduce((a, b) => a + b, 0) / values.length;
          let score = Math.round(mean * 10);
          if (criteriaDefects.some((d) => d.critical)) score = Math.min(score, CRITICAL_CAP);
          const defects = criteriaDefects.map((d) => (d.criterion ? `[${d.criterion}] ${d.issue}` : d.issue));
          return { score, defects, criteriaScores, criteriaDefects };
        }
      }
      // Old single-score format (or a malformed/empty `scores`).
      const score = Math.max(0, Math.min(100, Math.round(Number(o.score))));
      const defects = Array.isArray(o.defects) ? o.defects.map(String).filter(Boolean) : [];
      if (Number.isFinite(score)) return { score, defects };
    } catch {
      /* fall through to heuristic */
    }
  }
  const sm = text.match(/score[^0-9]*(\d{1,3})/i);
  const score = sm ? Math.max(0, Math.min(100, Number(sm[1]))) : 60;
  if (score >= FALLBACK_PASS_SCORE) return { score, defects: [] };
  const raw = text.trim().slice(0, 1500);
  return { score, defects: [raw || "（評価の解析に失敗。改善を継続）"] };
}

/** Merge per-criterion scores across `judgeSamples` parallel judges (min per
 * criterion — mirrors the existing overall-score policy: "a lenient sample
 * can't mask a defect"). undefined when none of the judgments carry a
 * per-criterion breakdown (old format). */
export function mergeCriteriaScores(judgments: Judgment[]): Record<string, number> | undefined {
  const withScores = judgments.filter((j) => j.criteriaScores);
  if (withScores.length === 0) return undefined;
  const merged: Record<string, number> = {};
  for (const j of withScores) {
    for (const [k, v] of Object.entries(j.criteriaScores!)) {
      merged[k] = k in merged ? Math.min(merged[k], v) : v;
    }
  }
  return merged;
}

/** The criterion key with the lowest merged score (ties → first seen in
 * insertion order). null for an empty map. */
export function lowestCriterion(scores: Record<string, number>): string | null {
  let best: string | null = null;
  let bestVal = Infinity;
  for (const [k, v] of Object.entries(scores)) {
    if (v < bestVal) {
      bestVal = v;
      best = k;
    }
  }
  return best;
}

/** Focus REFINE's defect list on the LOWEST-scoring criterion only (P13 §2):
 * a sharper instruction than "fix everything", and fewer input tokens. Falls
 * back to `allDefects` when there's no per-criterion breakdown (old format —
 * e.g. the brief had no parseable CRITERIA), or when the lowest-scoring
 * criterion happens to have no defect entries of its own attached (should be
 * rare, but never narrow the instruction down to nothing). Pure. */
export function focusDefects(judgments: Judgment[], allDefects: string[]): string[] {
  const merged = mergeCriteriaScores(judgments);
  if (!merged) return allDefects;
  const lowest = lowestCriterion(merged);
  if (!lowest) return allDefects;
  const focused = [
    ...new Set(
      judgments
        .flatMap((j) => j.criteriaDefects ?? [])
        .filter((d) => d.criterion === lowest)
        .map((d) => d.issue),
    ),
  ];
  return focused.length > 0 ? focused : allDefects;
}
