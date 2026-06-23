// Agent loop: lets the model use tools (read/write files, list dirs, run shell
// commands) to actually operate on the machine, not just answer questions.

import { invoke } from "@tauri-apps/api/core";
import { chatOnceStream, type ApiMessage, type Usage } from "./openrouter";

export type ToolStatus = "running" | "done" | "error" | "denied";

export type TodoStatus = "pending" | "in_progress" | "completed";
export interface Todo {
  content: string;
  status: TodoStatus;
}

/** A persisted transcript item shown in the chat pane. */
export type AgentItem =
  | { kind: "user"; content: string }
  | { kind: "assistant"; content: string }
  | { kind: "thought"; label: string; model: string; content: string }
  | { kind: "plan"; todos: Todo[] }
  | {
      kind: "tool";
      name: string;
      args: Record<string, unknown>;
      status: ToolStatus;
      result?: string;
    };

export const RISKY_TOOLS = new Set(["write_file", "run_command"]);

const MAX_ITERATIONS = 16;
const MAX_RESULT_CHARS = 12000;

interface CommandOutput {
  stdout: string;
  stderr: string;
  code: number;
}

export const TOOLS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the UTF-8 text contents of a file at an absolute path.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Absolute file path" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List the entries (files and folders) of a directory.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Absolute directory path" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create or overwrite a UTF-8 text file at an absolute path with the given content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute file path" },
          content: { type: "string", description: "Full file content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Run a shell command on the user's machine and return stdout, stderr and exit code. On Windows this runs via cmd.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The command line to execute" },
          cwd: { type: "string", description: "Optional absolute working directory" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep_search",
      description:
        "Search the workspace for a regular expression and return matching lines with file path and line number. Skips .git, node_modules, target, dist, build. Use this to locate code instead of guessing paths.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regular expression to search for" },
          path: { type: "string", description: "Optional absolute directory to search (defaults to the workspace root)" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_plan",
      description:
        "Record or update a step-by-step plan for a multi-step task so the user can follow progress. Call it at the start and whenever a step's status changes. Keep exactly one step 'in_progress' at a time.",
      parameters: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            description: "The full, current task list (replaces the previous one).",
            items: {
              type: "object",
              properties: {
                content: { type: "string" },
                status: { type: "string", enum: ["pending", "in_progress", "completed"] },
              },
              required: ["content", "status"],
            },
          },
        },
        required: ["todos"],
      },
    },
  },
];

function truncate(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  return text.slice(0, MAX_RESULT_CHARS) + `\n…(${text.length - MAX_RESULT_CHARS} 文字省略)`;
}

interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

async function execTool(
  name: string,
  args: Record<string, unknown>,
  workspaceRoot?: string,
): Promise<string> {
  switch (name) {
    case "read_file":
      return truncate(await invoke<string>("read_text_file", { path: String(args.path) }));
    case "list_dir": {
      const entries = await invoke("list_dir", { path: String(args.path) });
      return JSON.stringify(entries);
    }
    case "write_file":
      await invoke("write_text_file", {
        path: String(args.path),
        contents: String(args.content ?? ""),
      });
      return `書き込み完了: ${args.path}`;
    case "run_command": {
      const out = await invoke<CommandOutput>("run_command", {
        command: String(args.command),
        cwd: args.cwd ? String(args.cwd) : workspaceRoot ?? null,
      });
      return truncate(
        `exit code: ${out.code}\n--- stdout ---\n${out.stdout}\n--- stderr ---\n${out.stderr}`,
      );
    }
    case "grep_search": {
      const root = args.path ? String(args.path) : workspaceRoot;
      if (!root) return "検索対象のフォルダがありません（ワークスペースを開いてください）。";
      const hits = await invoke<SearchMatch[]>("grep_search", {
        root,
        pattern: String(args.pattern ?? ""),
        maxResults: null,
      });
      if (hits.length === 0) return "一致なし。";
      return truncate(hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join("\n"));
    }
    default:
      return `不明なツール: ${name}`;
  }
}

export interface AgentCallbacks {
  /** Append a finished assistant message (used by the non-streaming reasoning core). */
  onAssistantText: (text: string) => void;
  /** Stream a chunk of assistant text into the current bubble. */
  onAssistantDelta?: (chunk: string) => void;
  /** Mark the current streaming assistant bubble as finished. */
  onAssistantDone?: () => void;
  onToolStart: (call: { name: string; args: Record<string, unknown> }) => void;
  onToolEnd: (status: ToolStatus, result: string) => void;
  /** The agent updated its task plan. */
  onPlan?: (todos: Todo[]) => void;
  /** Ask the user to approve a risky tool call. */
  approve: (name: string, args: Record<string, unknown>) => Promise<boolean>;
  /** Reports token/cost usage for each underlying API call. */
  onUsage?: (usage: Usage) => void;
}

export interface AgentOptions {
  autoApprove: boolean;
  /** Optional model override (used for cost-efficient routing in the reasoning core). */
  model?: string;
  /** Workspace root; default cwd for run_command and search root for grep_search. */
  workspaceRoot?: string;
  signal?: { aborted: boolean };
}

/**
 * Run the agent loop starting from `messages` (system + history + latest user).
 * Drives tool calls until the model returns a final answer with no tool calls.
 * Returns the final assistant text.
 */
export async function runAgent(
  messages: ApiMessage[],
  cb: AgentCallbacks,
  opts: AgentOptions,
): Promise<string> {
  const conv: ApiMessage[] = [...messages];
  let finalText = "";

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (opts.signal?.aborted) return finalText;

    // Stream the assistant turn; falls back to onAssistantText if no delta hook.
    let streamed = "";
    const { message: assistant, usage } = await chatOnceStream(
      conv,
      TOOLS,
      opts.model,
      (chunk) => {
        streamed += chunk;
        cb.onAssistantDelta?.(chunk);
      },
    );
    cb.onUsage?.(usage);
    conv.push(assistant);

    if (assistant.content) {
      finalText = assistant.content;
      if (!cb.onAssistantDelta) cb.onAssistantText(assistant.content);
    }
    if (streamed || assistant.content) cb.onAssistantDone?.();

    const calls = assistant.tool_calls ?? [];
    if (calls.length === 0) return finalText; // final answer reached

    for (const call of calls) {
      if (opts.signal?.aborted) return finalText;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      const name = call.function.name;

      // Plan updates are UI-only: surface them and acknowledge to the model.
      if (name === "update_plan") {
        const todos = Array.isArray(args.todos) ? (args.todos as Todo[]) : [];
        cb.onPlan?.(todos);
        conv.push({ role: "tool", tool_call_id: call.id, content: "計画を更新しました。" });
        continue;
      }

      cb.onToolStart({ name, args });

      let status: ToolStatus = "done";
      let result = "";

      if (RISKY_TOOLS.has(name) && !opts.autoApprove) {
        const ok = await cb.approve(name, args);
        if (!ok) {
          status = "denied";
          result = "ユーザーが操作を拒否しました。別の方法を検討してください。";
        }
      }

      if (status !== "denied") {
        try {
          result = await execTool(name, args, opts.workspaceRoot);
        } catch (err) {
          status = "error";
          result = "エラー: " + (err instanceof Error ? err.message : String(err));
        }
      }

      cb.onToolEnd(status, result);
      conv.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  const limitMsg = `（ツール実行が上限の ${MAX_ITERATIONS} 回に達したため停止しました。続けるには指示を追加してください。）`;
  cb.onAssistantText(limitMsg);
  return finalText || limitMsg;
}
