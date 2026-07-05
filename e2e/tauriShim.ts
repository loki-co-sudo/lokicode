// e2e harness shim: replaces the Tauri Rust backend (`@tauri-apps/api/core`)
// with real OpenRouter HTTP calls and real (read-only) filesystem access, so
// the production reasoning/agent code runs unmodified under Node.
// Used only by the paid e2e run (`npm run e2e:deepthink`) — never by `npm test`.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ── API key: read from .env (same file the Rust backend reads) ───────────────
function apiKey(): string {
  const env = readFileSync(join(process.cwd(), ".env"), "utf8");
  const m = env.match(/^OPENROUTER_API_KEY=(.+)$/m);
  if (!m) throw new Error("OPENROUTER_API_KEY not found in .env");
  return m[1].trim();
}

export interface CallLogEntry {
  n: number;
  cmd: string;
  model: string;
  /** First 90 chars of the last message (phase fingerprint). */
  tail: string;
  ms: number;
  promptTokens: number;
  completionTokens: number;
  toolCalls: number;
}

export const callLog: CallLogEntry[] = [];
export const toolLog: { name: string; arg: string }[] = [];
let seq = 0;

interface OrUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
}

async function openrouter(
  messages: unknown[],
  model: string | null,
  tools?: unknown[],
): Promise<{ message: Record<string, unknown>; usage: OrUsage }> {
  const body: Record<string, unknown> = {
    model: model ?? "deepseek/deepseek-v4-flash",
    messages,
    usage: { include: true },
  };
  if (tools && (tools as unknown[]).length > 0) body.tools = tools;
  const t0 = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as {
    choices: { message: Record<string, unknown> }[];
    usage?: OrUsage;
  };
  const msg = json.choices[0].message;
  const usage = json.usage ?? {};
  const msgs = messages as { content?: unknown }[];
  const last = String(msgs[msgs.length - 1]?.content ?? "").replace(/\s+/g, " ");
  const entry: CallLogEntry = {
    n: ++seq,
    cmd: tools ? "chat_once_stream" : "complete",
    model: String(body.model),
    tail: last.slice(0, 90),
    ms: Date.now() - t0,
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    toolCalls: Array.isArray(msg.tool_calls) ? (msg.tool_calls as unknown[]).length : 0,
  };
  callLog.push(entry);
  console.log(
    `  [api #${entry.n}] ${entry.model.split("/")[1]} · ${(entry.ms / 1000).toFixed(1)}s · ` +
      `${entry.promptTokens}->${entry.completionTokens}tok · ${entry.toolCalls} toolcall(s) · "${entry.tail.slice(0, 60)}"`,
  );
  return { message: msg, usage };
}

function toUsage(u: OrUsage) {
  return {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
    cost: u.cost ?? 0,
  };
}

// ── read-only FS tools over the real repo ────────────────────────────────────
const SKIP_DIRS = new Set([".git", "node_modules", "target", "dist", "build"]);

function grepSearch(root: string, pattern: string, max = 200) {
  const re = new RegExp(pattern);
  const hits: { path: string; line: number; text: string }[] = [];
  const walk = (dir: string) => {
    if (hits.length >= max) return;
    for (const name of readdirSync(dir)) {
      if (hits.length >= max) return;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(p);
      } else if (st.size < 2_000_000) {
        let text: string;
        try {
          text = readFileSync(p, "utf8");
        } catch {
          continue;
        }
        if (text.includes("\u0000")) continue; // binary
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length && hits.length < max; i++) {
          if (re.test(lines[i])) hits.push({ path: p, line: i + 1, text: lines[i].slice(0, 300) });
        }
      }
    }
  };
  walk(root);
  return hits;
}

// ── the Tauri invoke() replacement ───────────────────────────────────────────
export async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  switch (cmd) {
    case "complete": {
      const { message, usage } = await openrouter(
        args.messages as unknown[],
        (args.model as string) ?? null,
      );
      return { content: String(message.content ?? ""), usage: toUsage(usage) } as T;
    }
    case "chat_once_stream": {
      const { message, usage } = await openrouter(
        args.messages as unknown[],
        (args.model as string) ?? null,
        args.tools as unknown[],
      );
      const onEvent = args.onEvent as { onmessage: (e: unknown) => void };
      onEvent.onmessage({
        type: "done",
        message: {
          role: "assistant",
          content: (message.content as string) ?? null,
          tool_calls: message.tool_calls,
        },
        usage: toUsage(usage),
      });
      return null as T;
    }
    case "read_text_file": {
      toolLog.push({ name: "read_file", arg: String(args.path) });
      return readFileSync(String(args.path), "utf8").replace(/^\uFEFF/, "") as T;
    }
    case "list_dir": {
      toolLog.push({ name: "list_dir", arg: String(args.path) });
      return readdirSync(String(args.path)).map((name) => {
        const isDir = statSync(join(String(args.path), name)).isDirectory();
        return { name, isDir };
      }) as T;
    }
    case "grep_search": {
      toolLog.push({ name: "grep_search", arg: String(args.pattern) });
      return grepSearch(String(args.root), String(args.pattern)) as T;
    }
    case "write_text_file":
      throw new Error("harness: write_text_file must not be called in read-only analysis runs");
    case "run_command":
      throw new Error("harness: run_command is not available in this harness");
    case "cancel_run":
    case "clear_run":
      return undefined as T;
    default:
      throw new Error(`harness: unmocked invoke("${cmd}")`);
  }
}

/** Minimal stand-in for @tauri-apps/api/core Channel. */
export class Channel<T> {
  onmessage: (event: T) => void = () => {};
}

/** In-memory localStorage so agentSettings getters work under Node. */
export function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}
