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

function readThreads(): Thread[] {
  try {
    const v = JSON.parse(localStorage.getItem(THREADS_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeThreads(threads: Thread[]) {
  localStorage.setItem(THREADS_KEY, JSON.stringify(threads));
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
  try {
    localStorage.setItem(itemsKey(id), JSON.stringify(items));
    const threads = readThreads();
    const t = threads.find((x) => x.id === id);
    if (t) {
      t.updatedAt = Date.now();
      writeThreads(threads);
    }
  } catch {
    // storage full / unavailable — non-fatal
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
