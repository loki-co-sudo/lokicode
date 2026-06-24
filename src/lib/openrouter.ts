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

let runCounter = 1;
/** Allocate a cancellation id for one pipeline run; thread it into completions. */
export function nextRunId(): number {
  return runCounter++;
}
/** Tell the backend to abort any in-flight request tagged with this run id. */
export function cancelRun(id: number): void {
  void invoke("cancel_run", { id }).catch(() => {});
}
/** Drop a finished run id from the backend cancellation registry. */
export function clearRun(id: number): void {
  void invoke("clear_run", { id }).catch(() => {});
}

/** One non-streaming completion with tool-calling support (optional model override). */
export function chatOnce(
  messages: ApiMessage[],
  tools: unknown[],
  model?: string,
  cancelId?: number,
): Promise<ChatOnceResult> {
  return invoke<ChatOnceResult>("chat_once", {
    messages,
    tools,
    model: model ?? null,
    cancelId: cancelId ?? null,
  });
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
  cancelId?: number,
): Promise<ChatOnceResult> {
  return new Promise<ChatOnceResult>((resolve, reject) => {
    const channel = new Channel<AgentStreamEvent>();
    channel.onmessage = (event) => {
      if (event.type === "delta") onDelta(event.content);
      else if (event.type === "done") resolve({ message: event.message, usage: event.usage });
      else if (event.type === "error") reject(new Error(event.message));
    };
    invoke("chat_once_stream", {
      messages,
      tools,
      model: model ?? null,
      cancelId: cancelId ?? null,
      onEvent: channel,
    }).catch(reject);
  });
}

export interface SettingsStatus {
  hasKey: boolean;
  model: string;
  /** True when the user explicitly chose a default model (not the fallback). */
  modelConfigured: boolean;
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
  /** Whether the model advertises tool/function calling. */
  supportsTools: boolean;
  /** Artificial Analysis indices when OpenRouter exposes them (else null). */
  intelligenceIndex: number | null;
  codingIndex: number | null;
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
export function complete(
  messages: ApiMessage[],
  model?: string,
  cancelId?: number,
): Promise<CompleteResult> {
  return invoke<CompleteResult>("complete", {
    messages,
    model: model ?? null,
    cancelId: cancelId ?? null,
  });
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
