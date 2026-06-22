// Frontend client that talks to the Rust backend. The API key lives in the Rust
// process (env/.env or the saved settings file) and is never shipped to the webview.

import { invoke, Channel } from "@tauri-apps/api/core";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type StreamEvent =
  | { type: "delta"; content: string }
  | { type: "done" }
  | { type: "error"; message: string };

export interface SettingsStatus {
  hasKey: boolean;
  model: string;
  keySource: "config" | "env" | "none";
}

export function getSettings(): Promise<SettingsStatus> {
  return invoke<SettingsStatus>("get_settings");
}

export function saveSettings(apiKey?: string, model?: string): Promise<void> {
  return invoke("save_settings", { apiKey: apiKey ?? null, model: model ?? null });
}

/**
 * Stream a chat completion. `onDelta` is called with each token chunk as it
 * arrives. Resolves when the stream finishes; rejects with the backend error.
 */
export async function streamChat(
  messages: ChatMessage[],
  onDelta: (chunk: string) => void,
): Promise<void> {
  const channel = new Channel<StreamEvent>();
  channel.onmessage = (event) => {
    if (event.type === "delta") onDelta(event.content);
  };
  await invoke("send_chat", { messages, onEvent: channel });
}
