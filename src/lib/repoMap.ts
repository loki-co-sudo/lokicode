// Repository map (frontier-roadmap P2): a file→symbol index handed to the
// architect (brief) and investigators so they can target reads instead of
// exploring the tree one grep/read at a time. This lowers the small model's
// context-gathering load — a context-engineering lever that sits OUTSIDE the
// resampling ceiling (speed-and-level §3 / frontier-roadmap §0, axis 3).
//
// Design choice: rather than a new Rust `repo_map` command (as the spec first
// sketched), we REUSE the existing `grep_search` — a repo map is just "grep for
// definition lines". Benefits: the extraction regex lives in ONE place (this
// file, the single source of truth), no Rust rebuild, and the e2e shim's
// grep_search runs the identical pattern so there is no engine drift.

import { grepSearch, type SearchMatch } from "./search";

// Definition-line matcher. Must be valid in BOTH the Rust `regex` crate
// (grep_search's backend) and JS RegExp (the e2e shim), so it uses only
// anchors, char classes, alternation and NON-capturing groups — no lookaround,
// no backreferences (Rust's regex crate supports neither). Covers the common
// definition forms across TS/JS/Rust/Python/Go/Java-like languages.
export const SYMBOL_PATTERN =
  "^\\s*(?:" +
  // function / class / interface / enum / type / Rust items / py def / go func
  "(?:export\\s+)?(?:default\\s+)?(?:abstract\\s+)?(?:async\\s+)?" +
  "(?:pub(?:\\([^)]*\\))?\\s+)?(?:unsafe\\s+)?" +
  "(?:function|class|interface|enum|trait|struct|union|impl|fn|def|func|type)\\s+[A-Za-z_]" +
  "|" +
  // exported bindings: export const/let/var X
  "export\\s+(?:const|let|var)\\s+[A-Za-z_]" +
  "|" +
  // arrow functions: (export )?const/let X = (...) =>  /  = async x =>
  "(?:export\\s+)?(?:const|let)\\s+[A-Za-z_$][\\w$]*\\s*=\\s*(?:async\\s+)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>" +
  ")";

/** Only code files belong in the map. Without this filter, definition-shaped
 * lines inside markdown code fences (specs/READMEs), snapshots or other text
 * files pollute the map — wasting budget and pointing the model at doc
 * snippets as if they were code locations. */
export const CODE_FILE =
  /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|rs|py|go|java|kt|cs|c|h|cc|cpp|hpp|rb|php|swift|scala|vue|svelte)$/i;

/** Tidy a raw signature line for the map: collapse whitespace, drop a trailing
 * opening brace, cap length. */
function cleanSignature(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s*\{\s*$/, "")
    .trim()
    .slice(0, 160);
}

/**
 * Render grep hits (definition lines) into a compact file→symbols map within a
 * character budget. Pure & unit-tested. Files keep first-seen order; each file
 * is capped at `perFileCap` symbols so one huge file can't crowd out the rest;
 * when the budget is exhausted the remaining files are summarized as omitted.
 */
export function formatRepoMap(
  matches: SearchMatch[],
  charBudget = 12000,
  perFileCap = 40,
): string {
  const byFile = new Map<string, { line: number; text: string }[]>();
  for (const m of matches) {
    if (!CODE_FILE.test(m.path)) continue;
    const arr = byFile.get(m.path) ?? [];
    if (arr.length < perFileCap) arr.push({ line: m.line, text: cleanSignature(m.text) });
    byFile.set(m.path, arr);
  }
  const files = [...byFile.entries()];
  let out = "";
  for (let i = 0; i < files.length; i++) {
    const [path, syms] = files[i];
    const block = `${path}\n` + syms.map((s) => `  ${s.line}: ${s.text}`).join("\n") + "\n";
    if (out.length + block.length > charBudget && out.length > 0) {
      return out.trimEnd() + `\n…(ほか ${files.length - i} ファイルは省略)`;
    }
    out += block;
  }
  return out.trimEnd();
}

/** Build the repository map for `root` by grepping for definition lines. Returns
 * "" on any failure (the pipeline treats an empty map as "no map"). */
export async function buildRepoMap(root: string): Promise<string> {
  try {
    const hits = await grepSearch(root, SYMBOL_PATTERN, 2000);
    return formatRepoMap(hits);
  } catch {
    return "";
  }
}
