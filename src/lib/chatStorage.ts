import type { ChatMessage } from "./openrouter";

const KEY = "lokicode.chat";

export function loadMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

export function saveMessages(messages: ChatMessage[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(messages));
  } catch {
    // storage full / unavailable — non-fatal
  }
}

export function clearMessages(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
