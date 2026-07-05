// Defect pattern long-term memory (frontier-roadmap P5): the judge's defect
// findings are normally thrown away each run. Here we accumulate them across
// sessions and inject the RECURRING ones back into future draft/final
// instructions as "common failures to avoid". The prompt gets stronger with
// experience — an accumulation lever (axis 4) outside the resampling ceiling.
//
// This memory holds only GENERAL, task-agnostic failure phrasings (e.g. "invented
// a specific number not in the evidence", "drifted to the wrong audience"), so it
// is safe to carry across different tasks. It is NEVER an answer cache.

const KEY = "lokicode.defectMemory";
/** Max distinct defect patterns kept (LRU-by-count eviction beyond this). */
export const MAX_ENTRIES = 100;
/** Only patterns seen at least this many times are injected — a one-off defect
 * is noise; a recurring one is a real weakness worth pre-warning against. */
export const DEFAULT_MIN_COUNT = 2;

export interface DefectRecord {
  /** How many times this normalized pattern has been recorded. */
  count: number;
  /** A representative original defect string (most recent), for display/injection. */
  text: string;
  /** Last-seen epoch ms (tie-breaker for top-N and eviction). */
  ts: number;
}

export type DefectStore = Record<string, DefectRecord>;

/**
 * Normalize a defect string into a clustering key: strip the specifics
 * (numbers, quoted/backticked spans, path-like tokens) that vary between
 * otherwise-identical findings, collapse whitespace, cap length. Returns "" for
 * strings too short to be a useful pattern. Pure.
 */
export function normalizeDefect(s: string): string {
  const norm = s
    .replace(/[`'"“”『』「」][^`'"“”『』「」]*[`'"“”『』「」]/g, "_") // quoted spans
    .replace(/[\w./\\-]*[/\\][\w./\\-]+/g, "_") // path-like tokens
    .replace(/\d+/g, "#") // numbers
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 120);
  return norm.length >= 8 ? norm : "";
}

/** Fold observed defects into a store (pure — returns a new store). Enforces the
 * size cap by evicting the lowest-count / oldest patterns. */
export function recordInto(store: DefectStore, defects: string[], now = Date.now()): DefectStore {
  const next: DefectStore = { ...store };
  for (const d of defects) {
    const key = normalizeDefect(d);
    if (!key) continue;
    const prev = next[key];
    next[key] = {
      count: (prev?.count ?? 0) + 1,
      text: d.trim().slice(0, 200),
      ts: now,
    };
  }
  const keys = Object.keys(next);
  if (keys.length > MAX_ENTRIES) {
    // Keep the strongest patterns: sort by count desc, then recency desc.
    const kept = keys
      .sort((a, b) => next[b].count - next[a].count || next[b].ts - next[a].ts)
      .slice(0, MAX_ENTRIES);
    const trimmed: DefectStore = {};
    for (const k of kept) trimmed[k] = next[k];
    return trimmed;
  }
  return next;
}

/** The most-recurring patterns worth pre-warning against (pure). */
export function topFrom(
  store: DefectStore,
  n = 3,
  minCount = DEFAULT_MIN_COUNT,
): DefectRecord[] {
  return Object.values(store)
    .filter((r) => r.count >= minCount)
    .sort((a, b) => b.count - a.count || b.ts - a.ts)
    .slice(0, Math.max(0, n));
}

/** Render the "avoid these" reminder block, or "" when there is nothing recurring. */
export function formatDefectReminder(records: DefectRecord[]): string {
  if (records.length === 0) return "";
  return (
    "過去のディープシンクで繰り返し指摘された失敗パターン（今回の回答ではこれらを避けること）:\n" +
    records.map((r) => `- ${r.text}`).join("\n")
  );
}

// ── localStorage-backed wrappers (thin; core logic is the pure fns above) ─────

export function loadDefectStore(): DefectStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as DefectStore;
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

function save(store: DefectStore) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // storage full / unavailable — best-effort, never fatal
  }
}

/** Record this run's defects for future runs. */
export function recordDefects(defects: string[]): void {
  if (!defects.length) return;
  save(recordInto(loadDefectStore(), defects));
}

/** Build the "common failures to avoid" reminder from prior runs (or "" if none). */
export function defectReminder(n = 3): string {
  return formatDefectReminder(topFrom(loadDefectStore(), n));
}

/** Number of distinct patterns currently remembered (for the settings UI). */
export function defectMemorySize(): number {
  return Object.keys(loadDefectStore()).length;
}

/** Manual clear (settings UI). */
export function clearDefectMemory(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* non-fatal */
  }
}
