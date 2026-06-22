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

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** OpenAI/OpenRouter-compatible message used by the agent loop. */
export interface ApiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/** One non-streaming completion with tool-calling support. */
export function chatOnce(messages: ApiMessage[], tools: unknown[]): Promise<ApiMessage> {
  return invoke<ApiMessage>("chat_once", { messages, tools });
}

export interface SettingsStatus {
  hasKey: boolean;
  model: string;
  keySource: "config" | "env" | "none";
}

export interface ModelInfo {
  id: string;
  name: string;
}

let modelsCache: ModelInfo[] | null = null;
let modelsInflight: Promise<ModelInfo[]> | null = null;

/** Fetch available models from OpenRouter (cached + deduped for the session). */
export async function listModels(force = false): Promise<ModelInfo[]> {
  if (modelsCache && !force) return modelsCache;
  if (modelsInflight && !force) return modelsInflight;
  modelsInflight = invoke<ModelInfo[]>("list_models")
    .then((models) => {
      modelsCache = models;
      modelsInflight = null;
      return models;
    })
    .catch((err) => {
      modelsInflight = null;
      throw err;
    });
  return modelsInflight;
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
