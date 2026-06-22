// OpenRouter chat-completions client.
//
// The API key is read from a Vite env var (VITE_OPENROUTER_API_KEY). For an MVP
// this keeps things simple and works without the Rust backend, but note that the
// key ends up in the frontend bundle — for a real distribution move this call
// behind a Tauri command so the key stays in the Rust process.

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

const API_URL = "https://openrouter.ai/api/v1/chat/completions";

const DEFAULT_MODEL =
  (import.meta.env.VITE_OPENROUTER_MODEL as string | undefined) ??
  "anthropic/claude-3.5-sonnet";

export function getApiKey(): string | undefined {
  return import.meta.env.VITE_OPENROUTER_API_KEY as string | undefined;
}

export function hasApiKey(): boolean {
  return Boolean(getApiKey());
}

export function getModel(): string {
  return DEFAULT_MODEL;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { role: string; content: string } }>;
  error?: { message?: string };
}

/**
 * Send a list of messages to OpenRouter and return the assistant's reply text.
 * Throws an Error with a human-readable message on failure.
 */
export async function sendChat(
  messages: ChatMessage[],
  options: { signal?: AbortSignal; model?: string } = {},
): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      "OpenRouter API key is not set. Copy .env.example to .env and set VITE_OPENROUTER_API_KEY.",
    );
  }

  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      signal: options.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Optional but recommended by OpenRouter for attribution.
        "HTTP-Referer": "http://localhost",
        "X-Title": "lokicode",
      },
      body: JSON.stringify({
        model: options.model ?? DEFAULT_MODEL,
        messages,
      }),
    });
  } catch (err) {
    throw new Error(
      `Network error contacting OpenRouter: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  let data: ChatCompletionResponse;
  try {
    data = (await res.json()) as ChatCompletionResponse;
  } catch {
    throw new Error(`OpenRouter returned a non-JSON response (HTTP ${res.status}).`);
  }

  if (!res.ok) {
    const detail = data.error?.message ?? res.statusText;
    throw new Error(`OpenRouter error (HTTP ${res.status}): ${detail}`);
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter returned an empty response.");
  }
  return content;
}
