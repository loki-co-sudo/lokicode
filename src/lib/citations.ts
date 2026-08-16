// Deterministic citation validation (deepthink-v3-roadmap P8/P9): the JUDGE is
// told to treat an unverified file/function name as a defect, but it only ever
// sees evidence TEXT, never the real files — so a plausible-looking but fake
// `path:line` citation sails through LLM judgment untouched (v3 roadmap §1.7,
// "欠陥F"). This module makes that check deterministic instead: read the file
// and confirm the line (and, when quoted, the excerpt) actually exists.
//
// Two stages, independently usable:
//   stage 1 (always applicable): the path exists and the line number is within
//     the file's line count.
//   stage 2 (only when the citation carries a quoted excerpt): the excerpt
//     appears within one line of the cited line (OCR/off-by-one tolerance).
// A citation with no excerpt is graded on stage 1 ONLY and is never treated as
// a stage-2 mismatch — that would be a false positive (v3 roadmap P9 step 2).

export interface Citation {
  /** Path exactly as cited (absolute or repo-relative); resolved by the reader. */
  path: string;
  line: number;
  /** Quoted excerpt of the cited line, when the source text included one. */
  quote?: string;
}

// path:line, e.g. `src/lib/reasoning.ts:451` or `` `agent.ts:120` `` or a full
// Windows/POSIX absolute path. Optionally followed by a quoted excerpt marked
// off with an em/en dash or arrow: `path:line — "excerpt"` / `path:line -> "excerpt"`.
const CITATION_RE =
  /([A-Za-z]:[\\/][^\s:*?"<>|]+?\.[a-z0-9]+|\/[^\s:*?"<>|]+?\.[a-z0-9]+|[\w][\w./\\-]*\.[a-z0-9]+):(\d+)(?:\s*(?:[—–-]+>?|→)\s*"([^"]+)")?/gi;

/** All distinct `path:line[:quote]` citations found in a text. Pure.
 * Dedups by (path, line) — the first quote seen for a pair wins. */
export function extractCitations(text: string): Citation[] {
  const out = new Map<string, Citation>();
  for (const m of text.matchAll(CITATION_RE)) {
    const path = m[1];
    const line = Number(m[2]);
    if (!Number.isFinite(line) || line < 1) continue;
    const key = `${path}:${line}`;
    if (!out.has(key)) out.set(key, { path, line, quote: m[3]?.trim() || undefined });
  }
  return [...out.values()];
}

export interface InvalidCitation {
  path: string;
  line: number;
  reason: "not-found" | "line-out-of-range" | "quote-mismatch";
}

export interface CitationCheckResult {
  ok: boolean;
  invalid: InvalidCitation[];
}

/** Validate citations against real file contents via an injected reader
 * (mirrors `evidenceCache.ts`'s reader-injection pattern — no Tauri import
 * here, so this stays a pure-logic module unit-testable under `npm test`).
 * `readFile` should resolve relative paths against the workspace root itself
 * (see `reasoning.ts`'s `makeCitedFileReader`) and return null when unreadable. */
export async function validateCitations(
  cites: Citation[],
  readFile: (path: string) => Promise<string | null>,
): Promise<CitationCheckResult> {
  const uniquePaths = [...new Set(cites.map((c) => c.path))];
  const linesByPath = new Map<string, string[] | null>();
  await Promise.all(
    uniquePaths.map(async (p) => {
      const content = await readFile(p).catch(() => null);
      linesByPath.set(p, content == null ? null : content.split(/\r?\n/));
    }),
  );

  const invalid: InvalidCitation[] = [];
  for (const c of cites) {
    const lines = linesByPath.get(c.path);
    if (lines == null) {
      invalid.push({ path: c.path, line: c.line, reason: "not-found" });
      continue;
    }
    if (c.line < 1 || c.line > lines.length) {
      invalid.push({ path: c.path, line: c.line, reason: "line-out-of-range" });
      continue;
    }
    if (c.quote) {
      // ±1 line tolerance: a citation off by one row from a since-edited file
      // shouldn't be graded a false mismatch.
      const window = lines
        .slice(Math.max(0, c.line - 2), Math.min(lines.length, c.line + 1))
        .join("\n");
      if (!window.includes(c.quote)) {
        invalid.push({ path: c.path, line: c.line, reason: "quote-mismatch" });
      }
    }
  }
  return { ok: invalid.length === 0, invalid };
}

// ── P9: gate investigation output on citation validity ──────────────────────
// A header line ("VERIFIED" / "ASSUMPTIONS" / "UNKNOWN", optionally followed
// by ":"/"：" and inline content) as produced by the INVESTIGATOR prompt in
// reasoning.ts. Matched at line start only, so a bullet like "- ASSUMPTIONS
// about X" (starting with "-") never mismatches as a header.
const SECTION_HEADER = /^\s*(VERIFIED|ASSUMPTIONS|UNKNOWN)[:：]?\s*(.*)$/i;

export interface DowngradeResult {
  text: string;
  /** Number of VERIFIED lines moved to ASSUMPTIONS. 0 → `text` is unchanged. */
  downgradedCount: number;
}

/** Downgrade VERIFIED lines whose citation(s) failed validation to ASSUMPTIONS
 * (deepthink-v3-roadmap P9): a plausible but fake `file:line` must not survive
 * as VERIFIED, since the JUDGE only reads evidence TEXT and cannot itself
 * detect a fabricated citation. Never deletes information — the fact moves,
 * annotated, rather than vanishing. `invalidKeys` is the set of "path:line"
 * strings that `validateCitations` flagged. Pure. */
export function downgradeUnverifiedCitations(
  text: string,
  invalidKeys: ReadonlySet<string>,
): DowngradeResult {
  if (invalidKeys.size === 0) return { text, downgradedCount: 0 };

  type Section = "VERIFIED" | "ASSUMPTIONS" | "UNKNOWN" | "OTHER";
  interface ParsedLine {
    section: Section;
    text: string;
    isHeader: boolean;
  }
  const parsed: ParsedLine[] = [];
  let current: Section = "OTHER";
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(SECTION_HEADER);
    if (m) {
      current = m[1].toUpperCase() as Section;
      parsed.push({ section: current, text: raw, isHeader: true });
      continue;
    }
    parsed.push({ section: current, text: raw, isHeader: false });
  }

  let downgradedCount = 0;
  const downgradedLines: string[] = [];
  const kept: ParsedLine[] = [];
  for (const p of parsed) {
    if (p.section === "VERIFIED" && !p.isHeader && p.text.trim() !== "") {
      const bad = extractCitations(p.text).some((c) => invalidKeys.has(`${c.path}:${c.line}`));
      if (bad) {
        downgradedCount++;
        downgradedLines.push(`${p.text.trim()} 〔未検証の引用のため自動降格〕`);
        continue;
      }
    }
    kept.push(p);
  }
  if (downgradedCount === 0) return { text, downgradedCount: 0 };

  const outLines = kept.map((p) => p.text);
  const assumeIdx = kept.findIndex((p) => p.isHeader && p.section === "ASSUMPTIONS");
  if (assumeIdx >= 0) {
    outLines.splice(assumeIdx + 1, 0, ...downgradedLines);
  } else {
    outLines.push("", "ASSUMPTIONS:", ...downgradedLines);
  }
  return { text: outLines.join("\n"), downgradedCount };
}
