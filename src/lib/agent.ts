// Agent loop: lets the model use tools (read/write files, list dirs, run shell
// commands) to actually operate on the machine, not just answer questions.

import { invoke } from "@tauri-apps/api/core";
import { chatOnceStream, type ApiMessage, type Usage } from "./openrouter";
import { getMaxIterations, getCommandTimeout, getRestrictToWorkspace } from "./agentSettings";

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

/** Approval policy levels for risky tools:
 *  - "manual"  : confirm every write_file / run_command (most cautious)
 *  - "standard": auto-approve routine work (edits, builds, read-only commands)
 *                but still confirm destructive commands and git-mutating commands
 *  - "auto"    : never prompt (most permissive) */
export type ApprovalLevel = "manual" | "standard" | "auto";

// Read-only inspection commands (and PowerShell cmdlets). If every piped/chained
// segment of a command leads with one of these, the whole command is read-only —
// checked FIRST so a safe command can't be misflagged by a substring (e.g. the
// `Format-Table` cmdlet must not trip the disk-`format` rule).
const READONLY_CMDS = new Set([
  "ls", "dir", "cat", "type", "head", "tail", "less", "more", "grep", "egrep", "fgrep",
  "findstr", "wc", "echo", "pwd", "stat", "file", "tree", "which", "where", "env",
  "printenv", "date", "whoami", "basename", "dirname", "realpath", "cd", "clear", "cls",
  "get-content", "get-childitem", "get-item", "get-itemproperty", "get-location",
  "get-process", "get-command", "get-help", "get-date", "get-member", "select-string",
  "select-object", "where-object", "measure-object", "sort-object", "group-object",
  "format-table", "format-list", "format-wide", "out-string", "out-host", "write-output",
  "write-host", "test-path", "resolve-path", "compare-object", "convertto-json",
  "convertfrom-json",
]);

const GIT_READ_ONLY =
  /^git\s+(status|log|diff|show|branch|remote|blame|rev-parse|describe|ls-files|ls-tree|cat-file|for-each-ref|name-rev|shortlog|reflog|tag|config|version|help)\b/i;
const GIT_MUTATING =
  /\bgit\s+(commit|push|pull|fetch|merge|rebase|reset|checkout|switch|restore|add|rm|mv|clean|cherry-pick|revert|apply|am|init|gc|prune|stash|update-ref|submodule)\b|\bgit\s+(branch|tag)\s+-(d|D)\b|\bgit\s+tag\s+-a\b|\bgit\s+remote\s+(add|remove|rm|set-url|rename)\b|\bgit\s+config\s+(?!--get|--list|-l\b)\S/i;

function leadingName(seg: string): string {
  const m = seg.trim().match(/^(\S+)/);
  if (!m) return "";
  return m[1].toLowerCase().replace(/\.exe$/, "").replace(/.*[\\/]/, "");
}

function segmentIsReadOnly(seg: string): boolean {
  const s = seg.trim();
  if (!s) return true;
  const tok = leadingName(s);
  if (tok === "powershell" || tok === "pwsh") {
    const inner = s.match(/(?:-Command|-c)\s+(.+)$/i);
    return inner ? isReadOnlyCommand(inner[1].replace(/^["']|["']$/g, "")) : false;
  }
  if (tok === "git") return GIT_READ_ONLY.test(s) && !GIT_MUTATING.test(s);
  return READONLY_CMDS.has(tok);
}

function isReadOnlyCommand(command: string): boolean {
  const segs = command
    .split(/\|\||&&|[|;`\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
  return segs.length > 0 && segs.every(segmentIsReadOnly);
}

/** Classify a shell command for the "standard" approval policy. Errs toward the
 * safer label so an unrecognized command is treated as needing confirmation. */
export function commandRisk(command: string): "safe" | "git-write" | "destructive" {
  // Known read-only command → always safe (prevents false destructive matches).
  if (isReadOnlyCommand(command)) return "safe";
  const c = command;
  // Irreversible / data-losing operations. `format` only counts as the disk
  // formatter (`format C:` / Format-Volume), never the `Format-*` output cmdlets.
  if (
    /(?:^|[\s&|;(])(rm|rmdir|rd|del|erase|unlink|shred|rimraf|ri)(?:[\s/]|$)|\bremove-item\b|\bformat\s+[a-z]:|\bformat-volume\b|\bclear-content\b|\bmkfs\b|\btruncate\b|drop\s+(?:table|database)|>\s*\/dev\/sd|\bdd\s+if=/i.test(
      c,
    )
  ) {
    return "destructive";
  }
  // git that changes repository state. Plain read-only git stays "safe".
  if (/(?:^|[\s&|;(])git(?:\s|$)/i.test(c) && GIT_MUTATING.test(c)) return "git-write";
  return "safe";
}

/** Whether a tool call should pause for user approval under the given policy. */
export function toolNeedsApproval(
  level: ApprovalLevel,
  name: string,
  args: Record<string, unknown>,
): boolean {
  if (!RISKY_TOOLS.has(name)) return false;
  if (level === "auto") return false;
  if (level === "manual") return true;
  // "standard": confirm only destructive / git-mutating commands; routine edits
  // (write_file, which has one-click undo) and safe commands run unattended.
  if (name === "run_command") {
    const risk = commandRisk(String(args.command ?? ""));
    return risk !== "safe";
  }
  return false; // write_file under "standard"
}

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
        "Run a shell command on the user's machine and return stdout, stderr and exit code. On Windows this runs via PowerShell (pwsh preferred) in a hidden window. Commands must be NON-INTERACTIVE: they cannot prompt, open an editor, or page output — for git use --no-pager and pass messages inline (e.g. git commit -m). Chain related steps in one call with ';'.",
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
      name: "parallel_query",
      description:
        "Answer several independent sub-questions in parallel (no tools / read-only) and get all results at once. Use to research multiple files or aspects concurrently, then synthesize.",
      parameters: {
        type: "object",
        properties: {
          tasks: {
            type: "array",
            description: "Independent prompts to answer in parallel.",
            items: { type: "string" },
          },
        },
        required: ["tasks"],
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

/** Tools that cannot mutate the machine — safe to run without approval and to
 * fan out in parallel. Used by the reasoning core's read-only investigation
 * phase so grounded research never blocks on (or races over) approval prompts. */
export const READ_ONLY_TOOLS = TOOLS.filter((t) => !RISKY_TOOLS.has(t.function.name));

/** Clarifying-question tool. Advertised only on interactive agent runs
 * (opts.allowAskUser) so reasoning sub-phases never interrupt with questions. */
export const ASK_USER_TOOL = {
  type: "function",
  function: {
    name: "ask_user",
    description:
      "Ask the user ONE concise clarifying question when the request is ambiguous or missing " +
      "information that materially changes the outcome. Returns the user's answer. Prefer this " +
      "over guessing on consequential ambiguity; never use it for trivial choices you can decide " +
      "yourself.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "One concise question for the user." },
      },
      required: ["question"],
    },
  },
};

function truncate(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  return text.slice(0, MAX_RESULT_CHARS) + `\n…(${text.length - MAX_RESULT_CHARS} 文字省略)`;
}

interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

/** Normalize an absolute path for containment comparison: unify separators,
 * resolve `.`/`..` segments, drop a trailing slash, lowercase (Windows is
 * case-insensitive). Resolving `..` is essential so `<root>/../secret` can't
 * slip past a naive prefix check. */
function normAbs(p: string): string {
  const out: string[] = [];
  for (const seg of p.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/").toLowerCase();
}

/** Is `target` inside (or equal to) `root`? Used to confine agent file access to
 * the workspace when the "restrict to workspace" setting is on. */
function withinWorkspace(target: string, root: string): boolean {
  const r = normAbs(root);
  const t = normAbs(target);
  return t === r || t.startsWith(r + "/");
}

/** Enforce the workspace-restriction setting on a tool call: returns a denial
 * string when a path argument escapes the workspace, else null (allowed). */
function workspaceGuard(
  name: string,
  args: Record<string, unknown>,
  workspaceRoot?: string,
): string | null {
  if (!workspaceRoot || !getRestrictToWorkspace()) return null;
  const candidate =
    name === "read_file" || name === "write_file" || name === "list_dir"
      ? args.path
      : name === "grep_search"
        ? args.path // optional; undefined → defaults to the workspace root (safe)
        : name === "run_command"
          ? args.cwd // optional; undefined → defaults to the workspace root (safe)
          : undefined;
  if (typeof candidate === "string" && candidate && !withinWorkspace(candidate, workspaceRoot)) {
    return (
      `拒否: 設定「ワークスペース外へのアクセスを制限」が有効です。` +
      `ワークスペース(${workspaceRoot})の外のパスは操作できません: ${candidate}`
    );
  }
  return null;
}

async function execTool(
  name: string,
  args: Record<string, unknown>,
  workspaceRoot?: string,
): Promise<string> {
  const denied = workspaceGuard(name, args, workspaceRoot);
  if (denied) return denied;
  switch (name) {
    case "read_file":
      return truncate(await invoke<string>("read_text_file", { path: String(args.path) }));
    case "list_dir": {
      const entries = await invoke("list_dir", { path: String(args.path) });
      return JSON.stringify(entries);
    }
    case "write_file": {
      // Models occasionally prefix the content with a UTF-8 BOM (U+FEFF),
      // which corrupts the first line (e.g. a Markdown heading) and dirties
      // diffs. Strip a single leading BOM defensively before writing.
      const content = String(args.content ?? "").replace(/^\uFEFF/, "");
      await invoke("write_text_file", {
        path: String(args.path),
        contents: content,
      });
      return `書き込み完了: ${args.path}`;
    }
    case "run_command": {
      const out = await invoke<CommandOutput>("run_command", {
        command: String(args.command),
        cwd: args.cwd ? String(args.cwd) : workspaceRoot ?? null,
        timeoutSecs: getCommandTimeout(),
      });
      return truncate(
        `exit code: ${out.code}\n--- stdout ---\n${out.stdout}\n--- stderr ---\n${out.stderr}`,
      );
    }
    case "parallel_query": {
      const tasks = Array.isArray(args.tasks) ? args.tasks.map(String).filter(Boolean) : [];
      if (tasks.length === 0) return "tasks が空です。";
      const results = await Promise.all(
        tasks.map(async (t, i) => {
          try {
            const r = await invoke<{ content: string }>("complete", {
              messages: [{ role: "user", content: t }],
              model: null,
            });
            return `## サブタスク ${i + 1}\n${t}\n\n${r.content}`;
          } catch (e) {
            return `## サブタスク ${i + 1}\n${t}\n\nエラー: ${e instanceof Error ? e.message : String(e)}`;
          }
        }),
      );
      return truncate(results.join("\n\n---\n\n"));
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
  /** About to write a file: `prev` is its content before the write, or null if new. */
  onFileEdit?: (path: string, prev: string | null) => void;
  /** Ask the user to approve a risky tool call. */
  approve: (name: string, args: Record<string, unknown>) => Promise<boolean>;
  /** Ask the user a clarifying question and await their answer (ask_user tool). */
  askUser?: (question: string) => Promise<string>;
  /** Reports token/cost usage for each underlying API call. */
  onUsage?: (usage: Usage) => void;
}

export interface AgentOptions {
  /** Approval policy for risky tools (write_file / run_command). */
  approval: ApprovalLevel;
  /** Optional model override (used for cost-efficient routing in the reasoning core). */
  model?: string;
  /** Workspace root; default cwd for run_command and search root for grep_search. */
  workspaceRoot?: string;
  signal?: { aborted: boolean };
  /** Restrict to read-only tools (no write_file/run_command): lets investigation
   * phases run unattended and in parallel without approval prompts. */
  readOnly?: boolean;
  /** Per-run cap on tool-loop rounds, overriding the global setting. Used by
   * deep-think's read-only phases (investigation/refine) whose useful work
   * saturates after a handful of reads — without a cap a small model wanders
   * one-read-per-turn for dozens of rounds (latency + ballooning context). */
  maxIterations?: number;
  /** When the iteration cap is hit, run ONE final NO-TOOLS turn asking the
   * model to write its structured output from what it has gathered, instead of
   * returning the generic limit message. Without this, a capped investigation
   * leaks "（ツール実行が上限に達したため停止）" downstream as if it were
   * evidence — observed in the 1.7.x e2e run, where it poisoned the draft and
   * the final answer. Deep-think's read-only phases set this. */
  finalizeOnCap?: boolean;
  /** Offer the ask_user tool (interactive top-level agent only). */
  allowAskUser?: boolean;
  /** Run id for backend cancellation; lets Stop abort an in-flight API call. */
  cancelId?: number;
  /** Label for the `[tag]` console timing logs (e.g. "execute" for deep-think). */
  traceTag?: string;
  /**
   * Called when the model returns a final answer with no tool calls (i.e. it wants
   * to stop). Return a non-empty string to REJECT the stop: that string is pushed
   * as a user message and the loop continues with full conversation context intact.
   * Return null/empty to accept the stop. Used by the deep-think executor to refuse
   * a premature stop while planned steps are still incomplete. Bounded internally by
   * MAX_IDLE_NUDGES so a model that genuinely cannot finish isn't pestered forever.
   */
  onIdle?: () => string | null;
}

/** Max consecutive times onIdle may reject a stop before we let the agent stop
 * anyway. Reset to 0 whenever the agent makes real progress (uses a tool), so this
 * only bounds *consecutive* no-progress nudges, not total continuations. */
const MAX_IDLE_NUDGES = 3;

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

  const baseTools = opts.readOnly ? READ_ONLY_TOOLS : TOOLS;
  const advertised =
    opts.allowAskUser && cb.askUser ? [...baseTools, ASK_USER_TOOL] : baseTools;
  const maxIterations = opts.maxIterations ?? getMaxIterations();
  // Live timing to the F12 console so a long agent loop isn't a black box: each
  // iteration logs its LLM round-trip time, tool calls, and per-tool durations.
  const trace = opts.traceTag ?? "agent";
  const runStart = performance.now();
  let idleNudges = 0;

  for (let i = 0; i < maxIterations; i++) {
    if (opts.signal?.aborted) return finalText;

    // Stream the assistant turn; falls back to onAssistantText if no delta hook.
    let streamed = "";
    const llmStart = performance.now();
    const { message: assistant, usage } = await chatOnceStream(
      conv,
      advertised,
      opts.model,
      (chunk) => {
        streamed += chunk;
        cb.onAssistantDelta?.(chunk);
      },
      opts.cancelId,
    );
    cb.onUsage?.(usage);
    conv.push(assistant);

    const nCalls = (assistant.tool_calls ?? []).length;
    console.log(
      `[${trace}] iter ${i + 1}/${maxIterations} · LLM ${((performance.now() - llmStart) / 1000).toFixed(1)}s · ` +
        `${opts.model || "(default)"} · ${nCalls} tool-call(s)` +
        (assistant.content ? ` · text ${assistant.content.length}c` : ""),
    );

    if (assistant.content) {
      finalText = assistant.content;
      if (!cb.onAssistantDelta) cb.onAssistantText(assistant.content);
    }
    if (streamed || assistant.content) cb.onAssistantDone?.();

    const calls = assistant.tool_calls ?? [];
    if (calls.length === 0) {
      // The model wants to stop. Before accepting, let onIdle veto a premature
      // stop (e.g. deep-think executor with unfinished plan steps). Bounded so a
      // model that truly can't proceed isn't nudged forever.
      const nudge = idleNudges < MAX_IDLE_NUDGES ? opts.onIdle?.() : null;
      if (nudge) {
        idleNudges++;
        console.log(
          `[${trace}] idle but not done — continuing (nudge ${idleNudges}/${MAX_IDLE_NUDGES})`,
        );
        conv.push({ role: "user", content: nudge });
        continue;
      }
      console.log(
        `[${trace}] done · ${((performance.now() - runStart) / 1000).toFixed(1)}s · ${i + 1} iteration(s)`,
      );
      return finalText; // final answer reached
    }
    // Real progress: reset the no-progress nudge budget.
    idleNudges = 0;

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

      // Clarifying question: pause and wait for the user's answer.
      if (name === "ask_user") {
        const q = String(args.question ?? "").trim() || "確認したいことがあります。";
        cb.onToolStart({ name, args });
        const answer =
          opts.allowAskUser && cb.askUser
            ? await cb.askUser(q)
            : "（この文脈では質問できません。最善の仮定を置いて進めてください）";
        cb.onToolEnd("done", answer);
        conv.push({ role: "tool", tool_call_id: call.id, content: `ユーザーの回答: ${answer}` });
        continue;
      }

      // Read-only phase: refuse mutating tools without prompting.
      if (opts.readOnly && RISKY_TOOLS.has(name)) {
        cb.onToolStart({ name, args });
        cb.onToolEnd("denied", "読み取り専用フェーズのため、この操作はスキップしました。");
        conv.push({
          role: "tool",
          tool_call_id: call.id,
          content: "読み取り専用の調査フェーズのため、この変更系ツールは実行できません。",
        });
        continue;
      }

      cb.onToolStart({ name, args });

      let status: ToolStatus = "done";
      let result = "";

      if (toolNeedsApproval(opts.approval, name, args)) {
        console.log(`[${trace}]   tool ${name} · 承認待ち（ユーザーの操作待ち）…`);
        const ok = await cb.approve(name, args);
        if (!ok) {
          status = "denied";
          result = "ユーザーが操作を拒否しました。別の方法を検討してください。";
        }
      }

      // Snapshot the file before an approved write so the edit can be undone.
      if (status !== "denied" && name === "write_file") {
        const p = String(args.path ?? "");
        let prev: string | null = null;
        try {
          prev = await invoke<string>("read_text_file", { path: p });
        } catch {
          prev = null; // file did not exist
        }
        cb.onFileEdit?.(p, prev);
      }

      if (status !== "denied") {
        const toolStart = performance.now();
        try {
          result = await execTool(name, args, opts.workspaceRoot);
        } catch (err) {
          status = "error";
          result = "エラー: " + (err instanceof Error ? err.message : String(err));
        }
        console.log(
          `[${trace}]   tool ${name} · ${((performance.now() - toolStart) / 1000).toFixed(1)}s · ${status}`,
        );
      }

      cb.onToolEnd(status, result);
      conv.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  // Iteration cap reached. For reasoning phases (finalizeOnCap) force one
  // final no-tools turn so the run still yields its structured output — honest
  // partial findings beat a generic limit message masquerading as evidence.
  if (opts.finalizeOnCap && !opts.signal?.aborted) {
    conv.push({
      role: "user",
      content:
        "ツールの実行回数が上限に達しました。これ以上ツールは使えません。" +
        "ここまでに得た情報だけで、指示された出力形式に従って最終出力を書いてください。" +
        "確認できた事実（file:line つき）と、確認できなかったこと（UNKNOWN）を正直に分けること。" +
        "推測を確認済みのように書いてはいけません。",
    });
    try {
      const { message, usage } = await chatOnceStream(conv, [], opts.model, () => {}, opts.cancelId);
      cb.onUsage?.(usage);
      if (message.content) {
        console.log(`[${trace}] cap reached — finalized without tools (${message.content.length}c)`);
        cb.onAssistantText(message.content);
        return message.content;
      }
    } catch {
      /* fall through to the limit message */
    }
  }

  const limitMsg = `（ツール実行が上限の ${maxIterations} 回に達したため停止しました。続けるには指示を追加するか、設定でループ上限を上げてください。）`;
  cb.onAssistantText(limitMsg);
  return finalText || limitMsg;
}
