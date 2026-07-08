// Verified-evidence cache (frontier-roadmap P4): investigation produces VERIFIED
// facts backed by file:line citations. We store those facts keyed to the task,
// each stamped with the content HASH of every file it cites. On a later run of
// the same task, a fact is re-injected ONLY IF every cited file's CURRENT hash
// still matches — so a fact is dropped the moment its file changes. This is an
// accumulation lever (axis 4): the second run starts already knowing things.
//
// ABSOLUTELY NOT an answer cache. We cache atomic, file-scoped, hash-invalidated
// FACTS only — never a final answer (a code change must never surface a stale
// answer). See frontier-roadmap.md "してはいけないこと".

const KEY = "lokicode.evidenceCache";
/** Max facts kept per task (most recent win). */
export const MAX_FACTS_PER_TASK = 30;
/** Max distinct tasks kept (LRU by last-write). */
export const MAX_TASKS = 20;
const MAX_FACT_LEN = 300;
/** Char budget for the injected known-facts block. */
const INJECT_BUDGET = 4000;

export interface CitedFile {
  /** Path exactly as cited (absolute or repo-relative); resolved by the reader. */
  path: string;
  /** Content hash at the time the fact was recorded. */
  hash: string;
}

export interface CachedFact {
  /** The VERIFIED fact text (with its file:line citation(s)). */
  fact: string;
  files: CitedFile[];
  /** Epoch ms when recorded (for LRU + display). */
  ts: number;
}

export type EvidenceStore = Record<string, CachedFact[]>;

/** FNV-1a 32-bit hash of the content — for change detection, not security.
 * A collision would at worst re-inject one stale fact (which the model is told
 * to re-verify and the judge re-checks), so cryptographic strength is unneeded. */
export function hashContent(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Stable key for a task = normalized user question. Facts are scoped to it so
 * a run only sees facts from prior runs of the SAME question (conservative:
 * never injects facts from an unrelated task). */
export function taskKeyFor(question: string): string {
  const norm = question.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 400);
  return hashContent(norm);
}

// file:line citation matcher: an absolute Windows path (C:\...\x.ts) OR an
// absolute POSIX path (/Users/x/proj/a.ts) OR a relative path (src/lib/x.ts /
// x.ts), followed by :<line>. Valid in JS RegExp.
const CITATION =
  /([A-Za-z]:[\\/][^\s:*?"<>|]+?\.[a-z0-9]+|\/[^\s:*?"<>|]+?\.[a-z0-9]+|[\w][\w./\\-]*\.[a-z0-9]+):\d+/gi;

/** All distinct file paths cited (as `path:line`) anywhere in a text. Pure. */
export function extractCitedPaths(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(CITATION)) out.add(m[1]);
  return [...out];
}

/**
 * Parse an investigation output and return its VERIFIED facts that carry at
 * least one file:line citation (facts we can hash-invalidate). Pure. Only the
 * VERIFIED section is read — ASSUMPTIONS / UNKNOWN are deliberately excluded.
 */
export function extractVerifiedFacts(text: string): { fact: string; paths: string[] }[] {
  const out: { fact: string; paths: string[] }[] = [];
  const seen = new Set<string>();
  // Scan EVERY VERIFIED section (joined evidence concatenates one per finding),
  // each ending at the next section header (ASSUMPTIONS / UNKNOWN / next 調査).
  const SECTION = /VERIFIED[:：]?\s*([\s\S]*?)(?:\n\s*(?:ASSUMPTIONS|UNKNOWN|検証済み|前提|不明|###)\b|$)/gi;
  for (const m of text.matchAll(SECTION)) {
    for (const raw of m[1].split(/\r?\n/)) {
      const line = raw.replace(/^\s*[-*•]\s*/, "").trim();
      if (line.length < 8 || seen.has(line)) continue;
      const paths = extractCitedPaths(line);
      if (paths.length === 0) continue; // no citation → cannot invalidate → skip
      seen.add(line);
      out.push({ fact: line.slice(0, MAX_FACT_LEN), paths });
    }
  }
  return out;
}

/** Fold newly-extracted facts into the store under `taskKey` (pure). Dedups by
 * fact text, caps facts/task and total tasks (LRU). `hashes` maps each cited
 * path to its current content hash (paths that could not be read are omitted →
 * such facts are skipped, since they can't be invalidated later). */
export function recordFactsInto(
  store: EvidenceStore,
  taskKey: string,
  facts: { fact: string; paths: string[] }[],
  hashes: Map<string, string>,
  now = Date.now(),
): EvidenceStore {
  const next: EvidenceStore = { ...store };
  const existing = new Map((next[taskKey] ?? []).map((f) => [f.fact, f]));
  for (const { fact, paths } of facts) {
    const files: CitedFile[] = [];
    for (const p of paths) {
      const h = hashes.get(p);
      if (h) files.push({ path: p, hash: h });
    }
    if (files.length === 0) continue; // no readable cited file → cannot invalidate
    existing.set(fact, { fact, files, ts: now });
  }
  // Most-recent facts first, capped.
  const merged = [...existing.values()].sort((a, b) => b.ts - a.ts).slice(0, MAX_FACTS_PER_TASK);
  next[taskKey] = merged;
  // Cap tasks (LRU by newest fact ts).
  const keys = Object.keys(next);
  if (keys.length > MAX_TASKS) {
    const newestTs = (k: string) => Math.max(0, ...next[k].map((f) => f.ts));
    const kept = keys.sort((a, b) => newestTs(b) - newestTs(a)).slice(0, MAX_TASKS);
    const trimmed: EvidenceStore = {};
    for (const k of kept) trimmed[k] = next[k];
    return trimmed;
  }
  return next;
}

/** Facts whose EVERY cited file's current hash still matches (pure). A file
 * missing from `current` (unreadable/deleted) counts as a mismatch → the fact
 * is dropped. This is the core safety property (hash invalidation). */
export function validFacts(facts: CachedFact[], current: Map<string, string | null>): CachedFact[] {
  return facts.filter((f) => f.files.every((cf) => current.get(cf.path) === cf.hash));
}

/** Render the injected known-facts block (pure). Framed so the model treats
 * them as a re-confirmed starting point, not as unquestionable current truth. */
export function formatCachedFacts(facts: CachedFact[]): string {
  if (facts.length === 0) return "";
  let body = "";
  for (const f of facts) {
    const line = `- ${f.fact}\n`;
    if (body.length + line.length > INJECT_BUDGET) break;
    body += line;
  }
  if (!body) return "";
  return (
    "以前のランで検証済みの事実（引用ファイルの現在の内容とハッシュ一致を確認済み＝まだ有効）。" +
    "調査の出発点として利用してよいが、最終回答では現在のファイルから file:line を再確認して引用すること。" +
    "ハッシュ不一致だったものは自動で除外済み:\n" +
    body.trimEnd()
  );
}

// ── localStorage-backed wrappers + async validation (reader injected) ─────────

export function loadEvidenceStore(): EvidenceStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as EvidenceStore;
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

function save(store: EvidenceStore) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* storage full / unavailable — best-effort */
  }
}

/** Read + hash every distinct path via the injected reader (which resolves and
 * reads the file, returning null if unreadable). Returns path→hash|null. */
async function currentHashes(
  paths: string[],
  read: (path: string) => Promise<string | null>,
): Promise<Map<string, string | null>> {
  const uniq = [...new Set(paths)];
  const entries = await Promise.all(
    uniq.map(async (p) => {
      const content = await read(p).catch(() => null);
      return [p, content == null ? null : hashContent(content)] as const;
    }),
  );
  return new Map(entries);
}

/** Build the "known verified facts" injection block for a task from prior runs,
 * dropping any whose cited file changed. "" when there is nothing valid. */
export async function buildCachedFactsMessage(
  taskKey: string,
  read: (path: string) => Promise<string | null>,
): Promise<string> {
  const facts = loadEvidenceStore()[taskKey];
  if (!facts || facts.length === 0) return "";
  const allPaths = facts.flatMap((f) => f.files.map((cf) => cf.path));
  const hashes = await currentHashes(allPaths, read);
  const valid = validFacts(facts, hashes);
  return formatCachedFacts(valid);
}

/** Record this run's VERIFIED facts (hashing their cited files NOW) for reuse. */
export async function recordVerifiedFacts(
  taskKey: string,
  investigationTexts: string[],
  read: (path: string) => Promise<string | null>,
): Promise<void> {
  const facts = investigationTexts.flatMap((t) => extractVerifiedFacts(t));
  if (facts.length === 0) return;
  const hashes = await currentHashes(facts.flatMap((f) => f.paths), read);
  // Drop nulls: only files we could read (and thus can invalidate later).
  const readable = new Map<string, string>();
  for (const [p, h] of hashes) if (h) readable.set(p, h);
  save(recordFactsInto(loadEvidenceStore(), taskKey, facts, readable));
}

/** Total facts across all tasks (for the settings UI). */
export function evidenceCacheSize(): number {
  return Object.values(loadEvidenceStore()).reduce((n, arr) => n + arr.length, 0);
}

export function clearEvidenceCache(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* non-fatal */
  }
}
