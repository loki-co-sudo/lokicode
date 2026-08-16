// Execution-phase conversation compaction (deepthink-v3-roadmap P11 §4). The
// agent loop (`agent.ts` `runAgent`) resends the WHOLE conversation on every
// iteration; on a long run (up to `maxIterations`, default 50) old tool
// results accumulate and the request grows roughly quadratically in latency
// and cost. This targets ONLY tool-result messages, and ONLY once the run has
// gone long enough that the saving is worth it (short runs are untouched).
//
// TWO ABSOLUTE CONDITIONS (CLAUDE.md "上限・退避・正規化" — violating either
// one is exactly how this repo produced its documented HTTP 400 incident,
// see fix-roadmap-deepthink-400-crossplatform-shell.md):
//   ① a `{role:"tool", tool_call_id}` message must stay 1:1 paired with the
//      assistant `tool_calls` entry that produced it — compaction rewrites a
//      message's `content` IN PLACE ONLY; it never deletes, reorders, or
//      merges messages (that pairing is exactly what a provider rejects on).
//   ② a rewritten `content` must never become the empty string (an empty
//      message is the other documented cause of the same class of failure).

import type { ApiMessage } from "./openrouter";

/** Iteration count (1-indexed) at which compaction starts firing. Short runs
 * never reach this, so their cost/behavior is unchanged. */
export const COMPACT_THRESHOLD = 15;
/** Most recent tool results kept verbatim (still likely relevant to the
 * model's immediate next step) — only OLDER ones are compacted. */
export const KEEP_RECENT_TOOL_RESULTS = 5;
/** How much of an old tool result's head is kept verbatim. */
export const COMPACT_KEEP_CHARS = 300;
/** Marker appended to a compacted message; also used to detect an
 * already-compacted message so a later pass doesn't re-truncate it. */
const COMPACT_MARKER = "〔圧縮済み〕";

export interface CompactionResult {
  conv: ApiMessage[];
  /** How many messages were rewritten this pass (0 = nothing to do — every
   * old tool result was already short or already compacted). */
  compactedCount: number;
}

/** Whether the run has gone long enough for compaction to be worth running.
 * Call once per iteration; a `false` result means skip compaction entirely
 * (no cost to short runs). */
export function shouldCompact(iteration: number, threshold = COMPACT_THRESHOLD): boolean {
  return iteration >= threshold;
}

/**
 * Rewrite old, long tool-result messages in `conv` to a head + reference note
 * (structure-preserving compaction, mirrors `evidence.ts`'s P11 approach but
 * applied to the live agent conversation instead of investigation findings).
 * Returns a NEW array (same length/order/roles/ids as the input — see the two
 * absolute conditions above) plus how many messages were actually rewritten.
 * Pure.
 */
export function compactToolResults(
  conv: ApiMessage[],
  keepRecent = KEEP_RECENT_TOOL_RESULTS,
  keepChars = COMPACT_KEEP_CHARS,
): CompactionResult {
  const toolIndices: number[] = [];
  for (let i = 0; i < conv.length; i++) if (conv[i].role === "tool") toolIndices.push(i);

  const eligibleForCompaction = new Set(
    toolIndices.slice(0, Math.max(0, toolIndices.length - keepRecent)),
  );

  let compactedCount = 0;
  const next = conv.map((m, i) => {
    if (!eligibleForCompaction.has(i)) return m;
    const content = String(m.content ?? "");
    if (content.length <= keepChars || content.includes(COMPACT_MARKER)) return m;
    const head = content.slice(0, Math.max(1, keepChars)).trimEnd();
    compactedCount++;
    return {
      ...m,
      content: `${head}\n…${COMPACT_MARKER}（元は全${content.length}文字。反復が進んだため要約）`,
    };
  });

  return { conv: next, compactedCount };
}
