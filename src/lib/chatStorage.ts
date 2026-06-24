import type { AgentItem } from "./agent";

// Multiple named conversation threads, each persisted under its own key.

export interface Thread {
  id: string;
  name: string;
  updatedAt: number;
}

const THREADS_KEY = "lokicode.threads";
const ACTIVE_KEY = "lokicode.activeThread";
const itemsKey = (id: string) => `lokicode.chat.${id}`;
const LEGACY_KEY = "lokicode.chat";

/** Write a key, swallowing failures (quota full / private mode). Returns success. */
export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

// Per-thread persistence is bounded so a long agent run (full file contents,
// command output, grep results accumulate in tool results) can't fill the
// ~5MB localStorage quota and wedge the whole app on the next launch.
const MAX_FIELD = 16_000; // cap user/assistant messages (the real conversation)
const MAX_THOUGHT = 2_000; // thoughts are verbose & ephemeral — cap hard
const MAX_TOOL = 4_000; // tool results
const MAX_ITEMS = 400; // cap items kept per thread

function cap(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "\n…(省略)" : s;
}

/** A persistence-only clone with oversized text fields trimmed. The live,
 * in-memory items keep their full content; only what we store is shrunk.
 * Deep-reasoning runs emit many large `thought`/`tool` items, so those are
 * capped aggressively to keep the stored thread well under the quota. */
function trimForStorage(items: AgentItem[]): AgentItem[] {
  const recent = items.length > MAX_ITEMS ? items.slice(-MAX_ITEMS) : items;
  return recent.map((it) => {
    if (it.kind === "tool") return { ...it, result: cap(it.result ?? "", MAX_TOOL) };
    if (it.kind === "thought") return { ...it, content: cap(it.content, MAX_THOUGHT) };
    if (it.kind === "assistant" || it.kind === "user")
      return { ...it, content: cap(it.content, MAX_FIELD) };
    return it;
  });
}

/** Fallback: the actual conversation (user/assistant + plan), dropping the
 * heavy thought/tool logs. Used when the full thread won't fit, so the
 * conversation itself is never lost to quota pressure. */
function conversationOnly(items: AgentItem[]): AgentItem[] {
  return items
    .filter((it) => it.kind === "user" || it.kind === "assistant" || it.kind === "plan")
    .map((it) =>
      it.kind === "assistant" || it.kind === "user"
        ? { ...it, content: cap(it.content, MAX_FIELD) }
        : it,
    );
}

function readThreads(): Thread[] {
  try {
    const v = JSON.parse(localStorage.getItem(THREADS_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeThreads(threads: Thread[]) {
  safeSetItem(THREADS_KEY, JSON.stringify(threads));
}

export function listThreads(): Thread[] {
  return readThreads().sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Ensure at least one thread exists (migrating any legacy conversation), return active id. */
export function ensureActiveThread(): string {
  let threads = readThreads();
  if (threads.length === 0) {
    const id = crypto.randomUUID();
    threads = [{ id, name: "会話 1", updatedAt: Date.now() }];
    writeThreads(threads);
    // Migrate the old single-conversation store, if present.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      localStorage.setItem(itemsKey(id), legacy);
      localStorage.removeItem(LEGACY_KEY);
    }
    localStorage.setItem(ACTIVE_KEY, id);
    return id;
  }
  const active = localStorage.getItem(ACTIVE_KEY);
  if (active && threads.some((t) => t.id === active)) return active;
  const fallback = listThreads()[0].id;
  localStorage.setItem(ACTIVE_KEY, fallback);
  return fallback;
}

export function getActiveThreadId(): string {
  return ensureActiveThread();
}

export function setActiveThreadId(id: string) {
  localStorage.setItem(ACTIVE_KEY, id);
}

export function loadThread(id: string): AgentItem[] {
  try {
    const raw = localStorage.getItem(itemsKey(id));
    return raw ? (JSON.parse(raw) as AgentItem[]) : [];
  } catch {
    return [];
  }
}

export function saveThread(id: string, items: AgentItem[]) {
  // Try richest → leanest, so quota pressure costs the verbose logs first and
  // the actual conversation (user/assistant) is preserved.
  if (
    !safeSetItem(itemsKey(id), JSON.stringify(trimForStorage(items))) &&
    !safeSetItem(itemsKey(id), JSON.stringify(conversationOnly(items)))
  ) {
    // Still too big: keep the most recent conversation turns, dropping oldest.
    let kept = conversationOnly(items);
    while (kept.length > 0 && !safeSetItem(itemsKey(id), JSON.stringify(kept))) {
      kept = kept.slice(Math.ceil(kept.length / 2));
    }
    if (kept.length === 0) safeSetItem(itemsKey(id), "[]");
  }
  const threads = readThreads();
  const t = threads.find((x) => x.id === id);
  if (t) {
    t.updatedAt = Date.now();
    writeThreads(threads);
  }
}

export function createThread(): Thread {
  const threads = readThreads();
  const n = threads.length + 1;
  const thread: Thread = { id: crypto.randomUUID(), name: `会話 ${n}`, updatedAt: Date.now() };
  writeThreads([thread, ...threads]);
  setActiveThreadId(thread.id);
  return thread;
}

export function renameThread(id: string, name: string) {
  const threads = readThreads();
  const t = threads.find((x) => x.id === id);
  if (t) {
    t.name = name.trim() || t.name;
    writeThreads(threads);
  }
}

/** Delete a thread; returns the id that should become active. */
export function deleteThread(id: string): string {
  let threads = readThreads().filter((t) => t.id !== id);
  localStorage.removeItem(itemsKey(id));
  if (threads.length === 0) {
    const t = { id: crypto.randomUUID(), name: "会話 1", updatedAt: Date.now() };
    threads = [t];
  }
  writeThreads(threads);
  const next = threads.sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
  setActiveThreadId(next);
  return next;
}
