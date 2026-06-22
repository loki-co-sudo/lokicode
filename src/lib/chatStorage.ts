import type { AgentItem } from "./agent";

const KEY = "lokicode.chat";

export function loadItems(): AgentItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AgentItem[]) : [];
  } catch {
    return [];
  }
}

export function saveItems(items: AgentItem[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // storage full / unavailable — non-fatal
  }
}

export function clearItems(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
