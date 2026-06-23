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

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
}

export interface ChatOnceResult {
  message: ApiMessage;
  usage: Usage;
}

/** One non-streaming completion with tool-calling support (optional model override). */
export function chatOnce(
  messages: ApiMessage[],
  tools: unknown[],
  model?: string,
): Promise<ChatOnceResult> {
  return invoke<ChatOnceResult>("chat_once", { messages, tools, model: model ?? null });
}

type AgentStreamEvent =
  | { type: "delta"; content: string }
  | { type: "done"; message: ApiMessage; usage: Usage }
  | { type: "error"; message: string };

/**
 * Streaming variant of {@link chatOnce}: `onDelta` fires with text as it streams;
 * resolves with the assembled assistant message (incl. tool calls) and usage.
 */
export function chatOnceStream(
  messages: ApiMessage[],
  tools: unknown[],
  model: string | undefined,
  onDelta: (chunk: string) => void,
): Promise<ChatOnceResult> {
  return new Promise<ChatOnceResult>((resolve, reject) => {
    const channel = new Channel<AgentStreamEvent>();
    channel.onmessage = (event) => {
      if (event.type === "delta") onDelta(event.content);
      else if (event.type === "done") resolve({ message: event.message, usage: event.usage });
      else if (event.type === "error") reject(new Error(event.message));
    };
    invoke("chat_once_stream", { messages, tools, model: model ?? null, onEvent: channel }).catch(
      reject,
    );
  });
}

export interface SettingsStatus {
  hasKey: boolean;
  model: string;
  keySource: "config" | "env" | "none";
  thinkingModel: string;
  synthesisModel: string;
  baseUrl: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  /** USD per prompt (input) token. 0 when unknown/free. */
  promptPrice: number;
  /** USD per completion (output) token. 0 when unknown/free. */
  completionPrice: number;
  /** Context window in tokens. 0 when unknown. */
  contextLength: number;
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

export function saveSettings(opts: {
  apiKey?: string;
  model?: string;
  thinkingModel?: string;
  synthesisModel?: string;
  baseUrl?: string;
}): Promise<void> {
  return invoke("save_settings", {
    apiKey: opts.apiKey ?? null,
    model: opts.model ?? null,
    thinkingModel: opts.thinkingModel ?? null,
    synthesisModel: opts.synthesisModel ?? null,
    baseUrl: opts.baseUrl ?? null,
  });
}

export interface CompleteResult {
  content: string;
  usage: Usage;
}

/** Plain completion with an explicit model (used by the reasoning core). */
export function complete(messages: ApiMessage[], model?: string): Promise<CompleteResult> {
  return invoke<CompleteResult>("complete", { messages, model: model ?? null });
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
