// Structure-preserving evidence compaction (deepthink-v3-roadmap P11, 欠陥C).
// The old `joinEvidence` in reasoning.ts split the char budget evenly across
// findings and tail-clipped each one — which, since investigation output is
// always ordered VERIFIED → ASSUMPTIONS → UNKNOWN, meant UNKNOWN (the
// "what's still unconfirmed" signal) was the FIRST thing to get cut, and at
// breadth=5 a VERIFIED line's file:line citation could be clipped mid-string.
// This module replaces that with a priority-ordered, whole-item budget: ALL
// VERIFIED lines (deduped) are kept first, UNKNOWN is always represented (at
// least as a count) even under a tight budget, and ASSUMPTIONS/prose take
// whatever remains — items are kept whole or evicted, never truncated
// mid-line, so a citation can never come out cut in half.

import { extractCitations } from "./citations";

// Mirrors citations.ts's SECTION_HEADER: a VERIFIED/ASSUMPTIONS/UNKNOWN header
// line as produced by the INVESTIGATOR prompt in reasoning.ts.
const SECTION_HEADER = /^\s*(VERIFIED|ASSUMPTIONS|UNKNOWN)[:：]?\s*(.*)$/i;

export interface ParsedFinding {
  /** The first non-header line (typically "### 調査: <question>"). */
  title: string;
  verified: string[];
  assumptions: string[];
  unknown: string[];
  /** Content outside any recognized header — rare (the INVESTIGATOR prompt
   * mandates the three sections), but a malformed response shouldn't
   * silently vanish. Kept as whole multi-line blocks so paragraph structure
   * survives (never split into bullets). */
  freeform: string[];
}

/** Parse one investigation finding into its structured sections. Pure. */
export function parseFinding(text: string): ParsedFinding {
  type Section = "VERIFIED" | "ASSUMPTIONS" | "UNKNOWN" | "OTHER";
  let title = "";
  const verified: string[] = [];
  const assumptions: string[] = [];
  const unknown: string[] = [];
  const otherLines: string[] = [];
  let current: Section = "OTHER";
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(SECTION_HEADER);
    if (m) {
      current = m[1].toUpperCase() as Section;
      continue;
    }
    const t = raw.trim();
    if (!t) continue;
    if (current === "OTHER") {
      if (!title) title = t;
      else otherLines.push(t);
    } else {
      // Strip a leading bullet marker (bare fact text; reassembly re-adds "- ").
      const bullet = t.replace(/^[-*•]\s*/, "");
      if (current === "VERIFIED") verified.push(bullet);
      else if (current === "ASSUMPTIONS") assumptions.push(bullet);
      else if (current === "UNKNOWN") unknown.push(bullet);
    }
  }
  const freeform = otherLines.length > 0 ? [otherLines.join("\n")] : [];
  return { title, verified, assumptions, unknown, freeform };
}

export interface CompactionResult {
  text: string;
  /** VERIFIED lines dropped for lack of budget (0 = every VERIFIED line
   * survived). Deduped lines don't count — a duplicate isn't "evicted",
   * it was never going to be kept twice. */
  evictedVerified: number;
}

const ITEM_OVERHEAD = 3; // "- " prefix + trailing "\n"
const UNKNOWN_HEADLINE_COST = 20; // small fixed allowance per finding's headline

/** The INVESTIGATOR prompt allows "none"/なし as a section's sole content
 * meaning "nothing here" — not an actual item to keep or count. */
function isNonePlaceholder(s: string): boolean {
  const t = s.trim();
  return /^none$/i.test(t) || t === "なし";
}

/** Dedup key for a VERIFIED line: its citation(s) if it has any (so the SAME
 * fact repeated across findings collapses to one), else the raw text. */
function verifiedKey(line: string): string {
  const cites = extractCitations(line);
  return cites.length > 0 ? cites.map((c) => `${c.path}:${c.line}`).join("|") : line;
}

/**
 * Join findings within `maxChars`, preserving structure (P11):
 *   ① every VERIFIED line (deduped by citation) claims the budget first —
 *      kept whole or evicted, never truncated mid-line;
 *   ② each finding's UNKNOWN section is always represented, at minimum as a
 *      count, even when the budget is otherwise exhausted;
 *   ③ ASSUMPTIONS and any unstructured "freeform" text share whatever budget
 *      remains, each item kept whole or dropped.
 * Pure. Reassembles one block per finding (mirrors the original layout) plus
 * a trailing eviction note when anything was dropped.
 */
export function compactEvidence(findings: string[], maxChars: number): CompactionResult {
  const parsed = findings.map(parseFinding);

  // ① VERIFIED: dedup across ALL findings, then admit in order until the
  // WHOLE budget is spent (VERIFIED gets first claim on all of it).
  const seen = new Set<string>();
  let verifiedBudget = maxChars;
  let evictedVerified = 0;
  const keptVerifiedByFinding: string[][] = parsed.map((p) => {
    const kept: string[] = [];
    for (const line of p.verified) {
      const key = verifiedKey(line);
      if (seen.has(key)) continue; // duplicate fact — drop silently, not an eviction
      seen.add(key);
      const cost = line.length + ITEM_OVERHEAD;
      if (cost <= verifiedBudget) {
        kept.push(line);
        verifiedBudget -= cost;
      } else {
        evictedVerified++;
      }
    }
    return kept;
  });

  // ② UNKNOWN headline: a small guaranteed allowance per finding that has any
  // UNKNOWN items, taken off the top even if it pushes the remainder negative
  // — the guarantee (some visibility into "what's still unconfirmed") matters
  // more than staying exactly within budget by a few dozen characters.
  let remaining = verifiedBudget;
  const unknownCounts = parsed.map((p) => p.unknown.filter((u) => !isNonePlaceholder(u)).length);
  for (const n of unknownCounts) if (n > 0) remaining -= UNKNOWN_HEADLINE_COST;

  // ③ ASSUMPTIONS + freeform share whatever remains, whole-item.
  const keptAssumptionsByFinding: string[][] = parsed.map((p) => {
    const kept: string[] = [];
    for (const a of p.assumptions) {
      if (isNonePlaceholder(a)) continue;
      const cost = a.length + ITEM_OVERHEAD;
      if (remaining >= cost) {
        kept.push(a);
        remaining -= cost;
      }
    }
    return kept;
  });
  const keptFreeformByFinding: string[][] = parsed.map((p) => {
    const kept: string[] = [];
    for (const f of p.freeform) {
      const cost = f.length + ITEM_OVERHEAD;
      if (remaining >= cost) {
        kept.push(f);
        remaining -= cost;
      }
    }
    return kept;
  });

  // Reassemble, one block per finding.
  const blocks: string[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i];
    const lines: string[] = [];
    if (p.title) lines.push(p.title);
    if (keptFreeformByFinding[i].length > 0) lines.push(...keptFreeformByFinding[i]);
    if (keptVerifiedByFinding[i].length > 0) {
      lines.push("VERIFIED:", ...keptVerifiedByFinding[i].map((l) => `- ${l}`));
    }
    if (keptAssumptionsByFinding[i].length > 0) {
      lines.push("ASSUMPTIONS:", ...keptAssumptionsByFinding[i].map((l) => `- ${l}`));
    }
    if (unknownCounts[i] > 0) {
      lines.push(`UNKNOWN: ${unknownCounts[i]}件（予算のため詳細省略。件数のみ表示）`);
    }
    if (lines.length > 0) blocks.push(lines.join("\n"));
  }

  let text = blocks.join("\n\n");
  if (evictedVerified > 0) {
    text += `\n\n〔予算のため VERIFIED ${evictedVerified}件を省略〕`;
  }
  return { text, evictedVerified };
}
