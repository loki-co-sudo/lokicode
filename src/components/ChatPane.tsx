import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  streamChat,
  complete,
  getSettings,
  saveSettings,
  type ApiMessage,
  type ChatMessage,
  type Usage,
} from "../lib/openrouter";
import {
  runAgent,
  type AgentItem,
  type ToolStatus,
  type Todo,
} from "../lib/agent";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { joinPath, writeFile, deleteFile } from "../lib/files";
import { listFiles } from "../lib/search";
import { runRecurrentReasoning, MAX_DEPTH, MAX_SAMPLES } from "../lib/reasoning";
import { useModels } from "../lib/useModels";
import {
  estimateDeepReasoningCost,
  approxTokens,
  loadCalib,
  recordCompletion,
  recordToolRun,
} from "../lib/cost";
import {
  ensureActiveThread,
  loadThread,
  saveThread,
  listThreads,
  createThread,
  renameThread,
  deleteThread,
  setActiveThreadId,
  safeSetItem,
  type Thread,
} from "../lib/chatStorage";
import { usePersistentBool } from "../lib/usePersistentState";
import Markdown from "./Markdown";
import ModelPicker from "./ModelPicker";
import DiffPreview from "./DiffPreview";

interface ChatPaneProps {
  onOpenSettings: () => void;
  settingsVersion: number;
  currentCode: string;
  currentFileName: string;
  currentFilePath: string | null;
  workspaceRoot: string | null;
}

export interface ChatPaneHandle {
  prefill: (text: string) => void;
}

interface PendingApproval {
  name: string;
  args: Record<string, unknown>;
  resolve: (ok: boolean) => void;
}

function buildSystemPrompt(
  fileName: string,
  filePath: string | null,
  workspaceRoot: string | null,
  rules: string,
): ApiMessage {
  return {
    role: "system",
    content: `You are lokicode's coding agent embedded in a desktop code editor running on Windows (shell: cmd).
You can use the provided tools to read/list/write files and run shell commands to actually accomplish the user's request — not just describe it.
Operating principles:
- Work from the GOAL and any CONSTRAINTS, not a fixed recipe: choose your own means, but never take irreversible actions beyond what was asked, and respect every stated constraint.
- For non-trivial tasks, first state a brief plan with update_plan (current understanding, unknowns, steps) and keep exactly one step in_progress; update it as you go.
- If the request is ambiguous or missing information in a way that materially changes the outcome, use ask_user to ask ONE concise question instead of guessing. Do not ask about trivia you can decide yourself.
- On errors or missing info, do not freeze or invent facts: gather evidence with tools, and if the same approach fails twice, switch strategy or ask_user rather than repeating it.
- Before giving your final answer, self-check it against the goal and constraints; if it is incomplete, wrong, or violates a constraint, fix it. Report honestly what you could not verify.
Guidelines:
- Use absolute Windows paths.
- Use grep_search to locate code across the workspace instead of guessing file paths.
- Read files before editing them; after changes you may verify by reading files or running commands.
- write_file and run_command require the user's approval; if a call is denied, propose an alternative.
- Be concise. Reply in the user's language (Japanese if they write Japanese) and use Markdown.
${workspaceRoot ? `The open workspace folder is: ${workspaceRoot} (use it as the base for relative work and as the cwd for run_command).` : ""}
${filePath ? `The user's active file is: ${filePath}` : `The active editor tab is unsaved (named "${fileName}").`}${
      rules.trim()
        ? `\n\nProject-specific instructions (from .lokicode/rules) — follow these:\n${rules.trim()}`
        : ""
    }`,
  };
}

function historyFromItems(items: AgentItem[]): ApiMessage[] {
  const out: ApiMessage[] = [];
  for (const it of items) {
    if (it.kind === "user") out.push({ role: "user", content: it.content });
    else if (it.kind === "assistant") out.push({ role: "assistant", content: it.content });
  }
  return out;
}

function toolLabel(name: string): string {
  return (
    {
      read_file: "ファイル読み取り",
      list_dir: "ディレクトリ一覧",
      write_file: "ファイル書き込み",
      run_command: "コマンド実行",
      grep_search: "コード検索",
    }[name] ?? name
  );
}

function StatusBadge({ status }: { status: ToolStatus }) {
  const map: Record<ToolStatus, [string, string]> = {
    running: ["実行中", "text-blue-300"],
    done: ["完了", "text-emerald-400"],
    error: ["エラー", "text-red-400"],
    denied: ["拒否", "text-neutral-400"],
  };
  const [label, cls] = map[status];
  return (
    <span className={"flex items-center gap-1 text-[11px] " + cls}>
      {status === "running" && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-300" />
      )}
      {label}
    </span>
  );
}

function ToolCard({
  item,
}: {
  item: Extract<AgentItem, { kind: "tool" }>;
}) {
  const [open, setOpen] = useState(false);
  const summary =
    item.name === "run_command"
      ? String(item.args.command ?? "")
      : item.name === "grep_search"
        ? String(item.args.pattern ?? "")
        : String(item.args.path ?? "");
  return (
    <div className="rounded-md border border-neutral-700 bg-neutral-800/60">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
      >
        <span>🛠</span>
        <span className="font-medium text-neutral-300">{toolLabel(item.name)}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-neutral-500">{summary}</span>
        <StatusBadge status={item.status} />
      </button>
      {open && item.result && (
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap border-t border-neutral-700 px-3 py-2 text-[11px] text-neutral-300">
          {item.result}
        </pre>
      )}
    </div>
  );
}

function ThoughtCard({ item }: { item: Extract<AgentItem, { kind: "thought" }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-indigo-800/50 bg-indigo-950/20">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
      >
        <span>🧠</span>
        <span className="font-medium text-indigo-300">{item.label}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-neutral-500">{item.model}</span>
        <span className="text-[11px] text-neutral-500">{open ? "閉じる" : "思考を見る"}</span>
      </button>
      {open && (
        <div className="border-t border-indigo-800/40 px-3 py-2 text-neutral-300">
          <Markdown content={item.content} />
        </div>
      )}
    </div>
  );
}

function PlanCard({ item }: { item: Extract<AgentItem, { kind: "plan" }> }) {
  const icon: Record<Todo["status"], string> = {
    completed: "✅",
    in_progress: "⏳",
    pending: "⬜",
  };
  return (
    <div className="rounded-md border border-neutral-700 bg-neutral-800/40 px-3 py-2">
      <div className="mb-1 text-xs font-medium text-neutral-300">📋 計画</div>
      <ul className="space-y-0.5 text-xs">
        {item.todos.map((t, i) => (
          <li key={i} className="flex items-start gap-2">
            <span>{icon[t.status]}</span>
            <span
              className={
                t.status === "completed"
                  ? "text-neutral-500 line-through"
                  : t.status === "in_progress"
                    ? "text-neutral-100"
                    : "text-neutral-400"
              }
            >
              {t.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Rotating, slightly whimsical status lines so a long pause never looks frozen.
const THINKING_PHRASES = [
  "思考を巡らせています",
  "コードの海を探索中",
  "次の一手を組み立てています",
  "ニューロンを温めています",
  "可能性を編んでいます",
  "文脈を咀嚼しています",
  "最善手を吟味中",
  "点と点をつないでいます",
];

/**
 * Shown while the agent is working. A breathing orb + shimmering phrase make it
 * obviously *alive*, and a ticking elapsed clock proves progress isn't stalled.
 * One 1s interval drives both (phrase rotates off the second count) — cheap, and
 * it unmounts the moment work finishes, so nothing keeps running idle.
 */
function ThinkingIndicator({ note }: { note?: string }) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setSec((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const phrase = note ?? THINKING_PHRASES[Math.floor(sec / 3) % THINKING_PHRASES.length];
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return (
    <div className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-[#202022] px-3 py-2.5">
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
        <span className="loki-breathe h-2.5 w-2.5 rounded-full bg-gradient-to-br from-emerald-400 to-blue-500" />
        <span className="loki-orbit absolute inset-0 rounded-full border border-emerald-400/30 border-t-emerald-300/80" />
      </span>
      <span className="loki-shimmer min-w-0 flex-1 truncate text-[13px] font-medium">
        {phrase}…
      </span>
      <span className="flex items-end gap-0.5" aria-hidden>
        <span className="loki-dot h-1 w-1 rounded-full bg-neutral-500" style={{ animationDelay: "0ms" }} />
        <span className="loki-dot h-1 w-1 rounded-full bg-neutral-500" style={{ animationDelay: "160ms" }} />
        <span className="loki-dot h-1 w-1 rounded-full bg-neutral-500" style={{ animationDelay: "320ms" }} />
      </span>
      <span className="font-mono text-[11px] tabular-nums text-neutral-600">
        {mm}:{ss}
      </span>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  title,
  accent = "bg-blue-600",
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  title?: string;
  accent?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      title={title}
      className={"flex items-center gap-1.5 text-xs " + (disabled ? "opacity-40" : "text-neutral-300")}
    >
      <span
        className={
          "relative inline-block h-4 w-7 shrink-0 rounded-full transition-colors " +
          (checked ? accent : "bg-neutral-600")
        }
      >
        <span
          className={
            "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all " +
            (checked ? "left-[14px]" : "left-0.5")
          }
        />
      </span>
      {label}
    </button>
  );
}

// Clarifying-question prompt (ask_user tool): the agent pauses until answered.
function AskUserCard({
  question,
  onAnswer,
}: {
  question: string;
  onAnswer: (answer: string) => void;
}) {
  const [val, setVal] = useState("");
  return (
    <div className="mx-3 mb-2 rounded-md border border-sky-600/60 bg-sky-950/30 p-3 text-xs">
      <p className="mb-1 font-medium text-sky-300">🤔 AI からの確認</p>
      <p className="mb-2 whitespace-pre-wrap text-neutral-200">{question}</p>
      <textarea
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (val.trim()) onAnswer(val.trim());
          }
        }}
        rows={2}
        placeholder="回答を入力（Enter で送信 / Shift+Enter で改行）"
        className="mb-2 w-full resize-none rounded border border-neutral-700 bg-[#2a2a2b] px-2 py-1.5 text-neutral-100 outline-none focus:border-sky-500"
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={() => onAnswer("（ユーザーは回答せず、最善の判断で進めるよう指示）")}
          className="rounded px-3 py-1 text-neutral-300 hover:bg-neutral-700"
        >
          スキップ
        </button>
        <button
          onClick={() => val.trim() && onAnswer(val.trim())}
          disabled={!val.trim()}
          className="rounded bg-sky-600 px-3 py-1 font-medium text-white hover:bg-sky-500 disabled:opacity-40"
        >
          回答
        </button>
      </div>
    </div>
  );
}

const ChatPane = forwardRef<ChatPaneHandle, ChatPaneProps>(function ChatPane(
  { onOpenSettings, settingsVersion, currentCode, currentFileName, currentFilePath, workspaceRoot },
  ref,
) {
  const [threadId, setThreadId] = useState(() => ensureActiveThread());
  const [items, setItems] = useState<AgentItem[]>(() => loadThread(threadId));
  const [threads, setThreads] = useState<Thread[]>(() => listThreads());
  const [threadMenu, setThreadMenu] = useState(false);
  const [input, setInput] = useState("");

  // Checkpoint of files the agent edited this session (path → content before edit).
  const [edits, setEdits] = useState<Map<string, string | null>>(new Map());

  // @-mention: workspace file list + suggestion popup state.
  const [wsFiles, setWsFiles] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(true);
  const [model, setModel] = useState("");
  const [thinkingModel, setThinkingModel] = useState("");
  const [synthesisModel, setSynthesisModel] = useState("");
  const [includeFile, setIncludeFile] = usePersistentBool("lokicode.includeFile", false);
  const [agentMode, setAgentMode] = usePersistentBool("lokicode.agentMode", true);
  const [autoApprove, setAutoApprove] = usePersistentBool("lokicode.autoApprove", false);
  const [selfCheck, setSelfCheck] = usePersistentBool("lokicode.selfCheck", true);
  const [deepReasoning, setDeepReasoning] = usePersistentBool("lokicode.deepReasoning", false);
  const [depth, setDepth] = useState<number>(() => {
    const v = Number(localStorage.getItem("lokicode.depth"));
    return v >= 1 && v <= MAX_DEPTH ? v : 4;
  });
  const [samples, setSamples] = useState<number>(() => {
    const v = Number(localStorage.getItem("lokicode.samples"));
    return v >= 1 && v <= MAX_SAMPLES ? v : 1;
  });
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<{
    question: string;
    resolve: (answer: string) => void;
  } | null>(null);
  const [usage, setUsage] = useState({ tokens: 0, cost: 0 });
  // Session cost cap in USD (0 = off). Warns / confirms before exceeding.
  const [costLimit, setCostLimit] = useState<number>(() => {
    const v = Number(localStorage.getItem("lokicode.costLimit"));
    return v > 0 ? v : 0;
  });
  useEffect(() => {
    safeSetItem("lokicode.costLimit", String(costLimit));
  }, [costLimit]);
  const overLimit = costLimit > 0 && usage.cost >= costLimit;
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false });
  const threadMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!threadMenu) return;
    function onDown(e: MouseEvent) {
      if (threadMenuRef.current && !threadMenuRef.current.contains(e.target as Node)) {
        setThreadMenu(false);
      }
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [threadMenu]);

  const { models } = useModels();
  // Calibration learned from real usage; refreshed after each run.
  const [calib, setCalib] = useState(() => loadCalib());

  // Workspace file list for @-mentions.
  useEffect(() => {
    if (!workspaceRoot) {
      setWsFiles([]);
      return;
    }
    listFiles(workspaceRoot)
      .then(setWsFiles)
      .catch(() => setWsFiles([]));
  }, [workspaceRoot]);

  // Project-specific instructions loaded from <root>/.lokicode/rules(.md).
  const [rulesText, setRulesText] = useState("");
  useEffect(() => {
    if (!workspaceRoot) {
      setRulesText("");
      return;
    }
    let cancelled = false;
    (async () => {
      for (const rel of [".lokicode/rules", ".lokicode/rules.md"]) {
        try {
          const txt = await invoke<string>("read_text_file", {
            path: joinPath(workspaceRoot, rel),
          });
          if (!cancelled) {
            setRulesText(txt);
            return;
          }
        } catch {
          /* try next candidate */
        }
      }
      if (!cancelled) setRulesText("");
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot]);
  const callCountRef = useRef(0);

  // Approximate input tokens of the base prompt that will be sent (system +
  // history + optional active file + the pending input). CJK-aware.
  const promptTokens = useMemo(() => {
    let tok = 180; // system prompt overhead
    tok += approxTokens(input);
    for (const it of items) {
      if (it.kind === "user" || it.kind === "assistant") tok += approxTokens(it.content);
    }
    if (includeFile) tok += approxTokens(currentCode);
    return tok;
  }, [items, input, includeFile, currentCode]);

  // Pre-send cost estimate for deep-reasoning runs (shown by the depth slider).
  const costEstimate = useMemo(() => {
    const priceOf = (id: string) => {
      const m = models.find((x) => x.id === id);
      return m ? { promptPrice: m.promptPrice, completionPrice: m.completionPrice } : undefined;
    };
    return estimateDeepReasoningCost({
      promptTokens,
      depth,
      samples,
      useTools: agentMode,
      thinking: priceOf(thinkingModel || model),
      synthesis: priceOf(synthesisModel || model),
      calib,
    });
  }, [models, promptTokens, depth, samples, agentMode, thinkingModel, synthesisModel, model, calib]);

  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return wsFiles.filter((f) => f.toLowerCase().includes(q)).slice(0, 8);
  }, [mentionQuery, wsFiles]);

  useImperativeHandle(ref, () => ({
    prefill(text: string) {
      setInput((prev) => (prev.trim() ? `${prev}\n${text}` : text));
      inputRef.current?.focus();
    },
  }));

  useEffect(() => {
    getSettings()
      .then((s) => {
        setHasKey(s.hasKey);
        setModel(s.model);
        setThinkingModel(s.thinkingModel);
        setSynthesisModel(s.synthesisModel);
      })
      .catch(() => {});
  }, [settingsVersion]);

  useEffect(() => {
    saveThread(threadId, items);
  }, [threadId, items]);

  useEffect(() => {
    safeSetItem("lokicode.depth", String(depth));
  }, [depth]);

  useEffect(() => {
    safeSetItem("lokicode.samples", String(samples));
  }, [samples]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [items, busy, pending]);

  // Auto-grow the input with its content (capped).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [input]);

  const streamingRef = useRef(false);

  function appendItem(item: AgentItem) {
    setItems((prev) => [...prev, item]);
  }

  // Stream assistant text into a growing bubble (creates one on the first chunk).
  function handleAssistantDelta(chunk: string) {
    setItems((prev) => {
      if (!streamingRef.current) {
        streamingRef.current = true;
        return [...prev, { kind: "assistant", content: chunk }];
      }
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].kind === "assistant") {
          const a = next[i] as Extract<AgentItem, { kind: "assistant" }>;
          next[i] = { ...a, content: a.content + chunk };
          break;
        }
      }
      return next;
    });
  }

  function handleAssistantDone() {
    streamingRef.current = false;
  }

  // Replace the existing plan card (one evolving checklist) or append a new one.
  function handlePlan(todos: Todo[]) {
    setItems((prev) => {
      const idx = prev.map((it) => it.kind).lastIndexOf("plan");
      if (idx === -1) return [...prev, { kind: "plan", todos }];
      const next = [...prev];
      next[idx] = { kind: "plan", todos };
      return next;
    });
  }

  function updateLastTool(status: ToolStatus, result: string) {
    setItems((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].kind === "tool" && (next[i] as { status: ToolStatus }).status === "running") {
          next[i] = { ...(next[i] as Extract<AgentItem, { kind: "tool" }>), status, result };
          break;
        }
      }
      return next;
    });
  }

  async function handleModelChange(id: string) {
    setModel(id);
    try {
      await saveSettings({ model: id });
    } catch {
      // ignore
    }
  }

  function addUsage(u: Usage) {
    setUsage((prev) => ({ tokens: prev.tokens + u.totalTokens, cost: prev.cost + u.cost }));
    // Feed real output sizes into the cost calibration.
    recordCompletion(u.completionTokens);
    callCountRef.current += 1;
  }

  function handleClear() {
    setItems([]);
    saveThread(threadId, []);
    setError(null);
    setUsage({ tokens: 0, cost: 0 });
    setEdits(new Map());
  }

  // Record the pre-edit content the first time the agent touches a file.
  function recordFileEdit(path: string, before: string | null) {
    setEdits((m) => {
      if (m.has(path)) return m;
      const n = new Map(m);
      n.set(path, before);
      return n;
    });
  }

  async function undoEdits() {
    for (const [path, before] of edits.entries()) {
      try {
        if (before === null) await deleteFile(path);
        else await writeFile(path, before);
      } catch {
        /* best-effort revert */
      }
    }
    setEdits(new Map());
    appendItem({ kind: "assistant", content: "_（AI による変更を元に戻しました。開いているタブは開き直してください）_" });
  }

  function switchThread(id: string) {
    setThreadMenu(false);
    if (id === threadId) return;
    setActiveThreadId(id);
    setThreadId(id);
    setItems(loadThread(id));
    setThreads(listThreads());
    setUsage({ tokens: 0, cost: 0 });
    setError(null);
    setEdits(new Map());
  }

  function newThread() {
    const t = createThread();
    setThreadMenu(false);
    setThreadId(t.id);
    setItems([]);
    setThreads(listThreads());
    setUsage({ tokens: 0, cost: 0 });
    setError(null);
    setEdits(new Map());
  }

  function renameCurrentThread() {
    const cur = threads.find((t) => t.id === threadId);
    const name = window.prompt("スレッド名", cur?.name ?? "");
    if (name && name.trim()) {
      renameThread(threadId, name.trim());
      setThreads(listThreads());
    }
  }

  function removeThread(id: string) {
    const next = deleteThread(id);
    setThreads(listThreads());
    if (id === threadId) {
      setThreadId(next);
      setItems(loadThread(next));
      setUsage({ tokens: 0, cost: 0 });
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || busy) return;

    // Cost cap: confirm before exceeding the configured session limit.
    if (overLimit) {
      const ok = await confirm(
        `セッションの累計コストが上限 $${costLimit} を超えています（現在 $${usage.cost.toFixed(4)}）。続行しますか？`,
        { title: "コスト上限", kind: "warning" },
      );
      if (!ok) return;
    }

    const history = historyFromItems(items);
    appendItem({ kind: "user", content: text });
    setInput("");
    setError(null);
    setBusy(true);
    setMentionQuery(null);
    streamingRef.current = false;
    callCountRef.current = 0;
    abortRef.current = { aborted: false };
    const signal = abortRef.current;

    const base: ApiMessage[] = [
      buildSystemPrompt(currentFileName, currentFilePath, workspaceRoot, rulesText),
    ];
    if (includeFile && currentCode.trim()) {
      base.push({
        role: "system",
        content: `Current contents of the active file "${currentFileName}":\n\n\`\`\`\n${currentCode}\n\`\`\``,
      });
    }
    // Attach @-mentioned workspace files as context.
    if (workspaceRoot) {
      const mentioned = Array.from(
        new Set((text.match(/@([^\s@]+)/g) ?? []).map((s) => s.slice(1))),
      );
      for (const rel of mentioned) {
        if (!wsFiles.includes(rel)) continue;
        try {
          const c = await invoke<string>("read_text_file", { path: joinPath(workspaceRoot, rel) });
          base.push({ role: "system", content: `Referenced file ${rel}:\n\`\`\`\n${c}\n\`\`\`` });
        } catch {
          /* unreadable — skip */
        }
      }
    }
    base.push(...history, { role: "user", content: text });

    try {
      if (deepReasoning) {
        await runRecurrentReasoning(
          base,
          {
            depth,
            samples,
            thinkingModel: thinkingModel || undefined,
            synthesisModel: synthesisModel || undefined,
            useTools: agentMode,
            autoApprove,
            signal,
          },
          {
            onThought: (label, m, content) =>
              appendItem({ kind: "thought", label, model: m, content }),
            onFinal: (text) => appendItem({ kind: "assistant", content: text }),
            onToolStart: ({ name, args }) =>
              appendItem({ kind: "tool", name, args, status: "running" }),
            onToolEnd: (status, result) => updateLastTool(status, result),
            approve: (name, args) =>
              new Promise<boolean>((resolve) => setPending({ name, args, resolve })),
            onUsage: addUsage,
            onFileEdit: recordFileEdit,
          },
        );
      } else if (agentMode) {
        const finalAnswer = await runAgent(
          base,
          {
            onAssistantText: (t) => appendItem({ kind: "assistant", content: t }),
            onAssistantDelta: handleAssistantDelta,
            onAssistantDone: handleAssistantDone,
            onPlan: handlePlan,
            onToolStart: ({ name, args }) =>
              appendItem({ kind: "tool", name, args, status: "running" }),
            onToolEnd: (status, result) => updateLastTool(status, result),
            approve: (name, args) =>
              new Promise<boolean>((resolve) => setPending({ name, args, resolve })),
            askUser: (question) =>
              new Promise<string>((resolve) => setPendingQuestion({ question, resolve })),
            onUsage: addUsage,
            onFileEdit: recordFileEdit,
          },
          { autoApprove, signal, workspaceRoot: workspaceRoot ?? undefined, allowAskUser: true },
        );

        // Lightweight self-check (principle 4) for plain agent mode: one review
        // pass against the goal/constraints; only surfaced if it finds a fix.
        if (selfCheck && finalAnswer && !signal.aborted) {
          const reviewMsgs: ApiMessage[] = [
            ...base,
            { role: "assistant", content: finalAnswer },
            {
              role: "user",
              content:
                "Review your answer above against the user's goal and any stated constraints. " +
                "If it is correct, complete and within constraints, reply with exactly `OK`. " +
                "Otherwise reply with the corrected, complete answer (no preamble).",
            },
          ];
          try {
            const { content, usage } = await complete(reviewMsgs, model || undefined);
            addUsage(usage);
            const t = content.trim();
            if (t.length > 8 && !/^OK\b/i.test(t)) {
              appendItem({ kind: "assistant", content: `🔍 セルフチェックによる修正:\n\n${t}` });
            }
          } catch {
            /* self-check is best-effort */
          }
        }
      } else {
        // Plain streaming chat (no tools).
        const msgs: ChatMessage[] = base.map((m) => ({
          role: m.role === "tool" ? "assistant" : m.role,
          content: m.content ?? "",
        }));
        appendItem({ kind: "assistant", content: "" });
        await streamChat(msgs, (chunk) => {
          setItems((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.kind === "assistant") {
              next[next.length - 1] = { ...last, content: last.content + chunk };
            }
            return next;
          });
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (signal.aborted) appendItem({ kind: "assistant", content: "_（停止しました）_" });
      // Calibrate the tool multiplier from this run, then refresh the estimate.
      // Structural agent-loop count of the pipeline: investigate(b) + draft +
      // verify(D) + final ≈ breadth + depth + 2 (plan is a plain completion).
      if (deepReasoning && agentMode) {
        const breadth = Math.max(1, samples);
        const structural = (breadth > 1 ? breadth : 0) + depth + 2;
        recordToolRun(callCountRef.current, structural);
      }
      setCalib(loadCalib());
      setBusy(false);
      setPending(null);
      setPendingQuestion(null);
    }
  }

  function handleStop() {
    abortRef.current.aborted = true;
    pending?.resolve(false);
    setPending(null);
    pendingQuestion?.resolve("（停止しました）");
    setPendingQuestion(null);
  }

  // Detect a trailing "@token" before the caret to drive the mention popup.
  function handleInputChange(value: string) {
    setInput(value);
    const el = inputRef.current;
    const pos = el?.selectionStart ?? value.length;
    const m = value.slice(0, pos).match(/@([^\s@]*)$/);
    if (m) {
      setMentionQuery(m[1]);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  }

  function insertMention(path: string) {
    const el = inputRef.current;
    const pos = el?.selectionStart ?? input.length;
    const before = input.slice(0, pos).replace(/@([^\s@]*)$/, `@${path} `);
    const next = before + input.slice(pos);
    setInput(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery !== null && mentionSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, mentionSuggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(mentionSuggestions[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function resolveApproval(ok: boolean) {
    pending?.resolve(ok);
    setPending(null);
  }

  function answerQuestion(answer: string) {
    pendingQuestion?.resolve(answer);
    setPendingQuestion(null);
  }

  return (
    <div className="flex h-full flex-col bg-[#1b1b1c]">
      <div className="flex items-center gap-2 border-b border-neutral-800 bg-[#252526] px-3 py-2">
        <div className="relative" ref={threadMenuRef}>
          <button
            onClick={() => setThreadMenu((v) => !v)}
            title="会話スレッド"
            className="rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
          {threadMenu && (
            <div className="absolute left-0 top-full z-50 mt-1 max-h-80 w-64 overflow-auto rounded-md border border-neutral-700 bg-[#252526] py-1 shadow-xl">
              {threads.map((t) => (
                <div
                  key={t.id}
                  className={
                    "group flex items-center gap-1 px-2 py-1 text-xs hover:bg-neutral-700 " +
                    (t.id === threadId ? "text-blue-300" : "text-neutral-300")
                  }
                >
                  <button onClick={() => switchThread(t.id)} className="min-w-0 flex-1 truncate text-left">
                    {t.id === threadId ? "● " : ""}
                    {t.name}
                  </button>
                  <button
                    onClick={() => removeThread(t.id)}
                    title="削除"
                    className="rounded px-1 text-neutral-500 opacity-0 hover:text-red-400 group-hover:opacity-100"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div className="my-1 border-t border-neutral-700" />
              <button onClick={newThread} className="block w-full px-2 py-1 text-left text-xs text-emerald-400 hover:bg-neutral-700">
                ＋ 新しい会話
              </button>
              <button onClick={renameCurrentThread} className="block w-full px-2 py-1 text-left text-xs text-neutral-400 hover:bg-neutral-700">
                現在の会話の名前を変更
              </button>
            </div>
          )}
        </div>
        <span className="text-sm font-medium text-neutral-200">AI Agent</span>
        <div className="flex-1" />
        <button onClick={handleClear} title="会話をクリア" className="rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          </svg>
        </button>
        <button onClick={onOpenSettings} title="設定" className="rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      {(usage.tokens > 0 || costLimit > 0) && (
        <div
          className={
            "flex items-center justify-end gap-2 border-b border-neutral-800 px-3 py-1 text-[11px] " +
            (overLimit ? "bg-red-950/40 text-red-300" : "bg-[#1f1f20] text-neutral-500")
          }
        >
          {overLimit && <span className="mr-auto font-medium">⚠ コスト上限を超過</span>}
          <span>セッション使用量: {usage.tokens.toLocaleString()} tokens</span>
          {usage.cost > 0 && <span>· ${usage.cost.toFixed(4)}</span>}
          <label className="flex items-center gap-0.5" title="累計コストがこの金額(USD)を超えると警告。0で無効">
            <span className="text-neutral-600">/ 上限 $</span>
            <input
              type="number"
              min={0}
              step={0.01}
              value={costLimit || ""}
              onChange={(e) => setCostLimit(Number(e.target.value) || 0)}
              placeholder="0"
              className="w-14 rounded border border-neutral-700 bg-[#2a2a2b] px-1 py-0.5 text-[11px] text-neutral-200 outline-none focus:border-blue-500"
            />
          </label>
        </div>
      )}

      {!hasKey && (
        <div className="m-3 rounded-md border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
          API キーが未設定です。
          <button onClick={onOpenSettings} className="ml-1 underline hover:text-amber-200">設定から入力</button>
          してください。
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {items.length === 0 && (
          <p className="mt-8 text-center text-sm text-neutral-600">
            コードの生成・編集やコマンド実行を AI に依頼できます。
          </p>
        )}
        {items.map((it, i) => {
          if (it.kind === "tool") return <ToolCard key={i} item={it} />;
          if (it.kind === "thought") return <ThoughtCard key={i} item={it} />;
          if (it.kind === "plan") return <PlanCard key={i} item={it} />;
          if (it.kind === "user") {
            // Sender turn: a restrained, right-aligned chip — no loud bubble.
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-xl rounded-br-sm bg-[#2b2d31] px-3.5 py-2 text-[13px] leading-relaxed text-neutral-200 ring-1 ring-white/5">
                  {it.content}
                </div>
              </div>
            );
          }
          // Agent turn: flows on the panel under a subtle identity line and a
          // thread rail, rather than a chat bubble.
          return (
            <div key={i} className="group relative border-l border-neutral-800 pl-3">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-emerald-500/70">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/80" />
                lokicode
              </div>
              <div className="text-neutral-100">
                <Markdown content={it.content} />
              </div>
              {it.content && (
                <button
                  onClick={() => navigator.clipboard.writeText(it.content).catch(() => {})}
                  title="コピー"
                  className="absolute right-0 top-0 rounded bg-neutral-700/80 px-1.5 py-0.5 text-[10px] text-neutral-300 opacity-0 transition hover:text-neutral-100 group-hover:opacity-100"
                >
                  コピー
                </button>
              )}
            </div>
          );
        })}
        {busy && !pending && !pendingQuestion && <ThinkingIndicator />}
        {error && (
          <div className="rounded-md border border-red-800/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
      </div>

      {pendingQuestion && <AskUserCard question={pendingQuestion.question} onAnswer={answerQuestion} />}

      {pending && (
        <div className="mx-3 mb-2 rounded-md border border-amber-600/60 bg-amber-950/30 p-3 text-xs">
          <p className="mb-1 font-medium text-amber-300">
            AI が次の操作を実行しようとしています（{toolLabel(pending.name)}）
          </p>
          <div className="mb-2">
            {pending.name === "write_file" ? (
              <DiffPreview
                path={String(pending.args.path ?? "")}
                newContent={String(pending.args.content ?? "")}
              />
            ) : (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-[11px] text-neutral-200">
                {pending.name === "run_command"
                  ? String(pending.args.command ?? "")
                  : JSON.stringify(pending.args, null, 2)}
              </pre>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => resolveApproval(false)} className="rounded px-3 py-1 text-neutral-300 hover:bg-neutral-700">
              拒否
            </button>
            <button onClick={() => resolveApproval(true)} className="rounded bg-emerald-600 px-3 py-1 font-medium text-white hover:bg-emerald-500">
              承認して実行
            </button>
          </div>
        </div>
      )}

      <div className="border-t border-neutral-800 p-3">
        {edits.size > 0 && (
          <div className="mb-2 flex items-center gap-2 rounded bg-neutral-800/60 px-2 py-1 text-[11px] text-neutral-300">
            <span>AI が {edits.size} ファイルを変更しました</span>
            <button
              onClick={undoEdits}
              title="このセッションでの AI の変更をすべて元に戻す"
              className="ml-auto rounded bg-neutral-700 px-2 py-0.5 hover:bg-neutral-600"
            >
              ↩ 変更を元に戻す
            </button>
          </div>
        )}
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-neutral-400">
          <Toggle
            checked={agentMode}
            onChange={setAgentMode}
            label={agentMode ? "Agent モード" : "Chat モード"}
            title="ON: AI がツール（ファイル読み書き・コマンド・検索）を使って作業します。OFF: 通常のチャット。"
          />
          <Toggle
            checked={deepReasoning}
            onChange={setDeepReasoning}
            accent="bg-indigo-500"
            label="ディープ推論"
            title="ドラフト→内省→合成を反復して回答の質を上げます（API 呼び出しが増え高コスト）。"
          />
          {agentMode && (
            <Toggle
              checked={autoApprove}
              onChange={setAutoApprove}
              accent="bg-amber-500"
              label="自動承認"
              title="承認なしで書き込み・コマンドを実行します（注意）。"
            />
          )}
          {agentMode && !deepReasoning && (
            <Toggle
              checked={selfCheck}
              onChange={setSelfCheck}
              accent="bg-sky-500"
              label="セルフチェック"
              title="回答前に、目的・制約に照らして自己点検し、必要なら修正します（1回の追加 API 呼び出し）。"
            />
          )}
          <Toggle
            checked={includeFile}
            onChange={setIncludeFile}
            label="現在のファイルを文脈に含める"
          />

          <div className="flex w-full items-center gap-1">
            <span className="shrink-0 text-[11px] text-neutral-500">モデル</span>
            <ModelPicker
              value={model}
              onChange={handleModelChange}
              listId="chat-models"
              placement="up"
              className="min-w-0 flex-1"
            />
          </div>

          {deepReasoning && (
            <>
              <label className="flex items-center gap-1.5" title="検証フェーズ（敵対的レビュー→改善）の反復回数。多いほど高品質・高コスト">
                検証の深さ
                <input
                  type="range"
                  min={1}
                  max={MAX_DEPTH}
                  value={depth}
                  onChange={(e) => setDepth(Number(e.target.value))}
                  className="accent-indigo-500"
                />
                <span className="w-5 text-center font-mono text-indigo-300">{depth}</span>
              </label>
              <label
                className="flex items-center gap-1.5"
                title="課題を独立した観点に分解して並行調査する数。2 以上で「計画→多角調査→統合」を行い結論の質と網羅性が上がります（1 で分解なし）。Agent モードでは読み取り専用ツールで事実確認しながら調査します"
              >
                調査の広さ
                <input
                  type="range"
                  min={1}
                  max={MAX_SAMPLES}
                  value={samples}
                  onChange={(e) => setSamples(Number(e.target.value))}
                  className="accent-indigo-500"
                />
                <span className="w-4 text-center font-mono text-indigo-300">{samples}</span>
              </label>
              <div className="flex w-full items-center gap-1 text-[11px] text-neutral-500" title="思考/合成モデル・思考深度・サンプル数・Agent モードから概算した OpenRouter 料金（送信前の目安）">
                <span>💰 概算コスト:</span>
                {costEstimate.ok ? (
                  <span className="font-mono text-amber-300/90">
                    ≈ ${costEstimate.usd < 0.01 ? costEstimate.usd.toFixed(4) : costEstimate.usd.toFixed(3)}
                  </span>
                ) : (
                  <span className="text-neutral-600">モデル価格不明（一覧から選択すると表示）</span>
                )}
                {costEstimate.ok && (
                  <span className="text-neutral-600">
                    （約 {costEstimate.calls} 回の API 呼び出し想定{agentMode ? "・ツール込み" : ""}）
                  </span>
                )}
                {costEstimate.calibrated && <span className="text-emerald-600/80" title="過去の実使用量から補正済み">✓ 実測補正</span>}
              </div>
            </>
          )}
        </div>
        <div className="relative flex items-end gap-2">
          {mentionQuery !== null && mentionSuggestions.length > 0 && (
            <div className="absolute bottom-full left-0 z-50 mb-1 max-h-56 w-[28rem] max-w-full overflow-auto rounded-md border border-neutral-700 bg-[#252526] py-1 shadow-xl">
              <div className="px-3 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
                ファイルを文脈に添付（@）
              </div>
              {mentionSuggestions.map((f, i) => (
                <button
                  key={f}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertMention(f);
                  }}
                  onMouseMove={() => setMentionIndex(i)}
                  className={
                    "block w-full truncate px-3 py-1 text-left text-xs " +
                    (i === mentionIndex ? "bg-blue-600/30 text-neutral-100" : "text-neutral-300")
                  }
                >
                  {f}
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            className="min-h-[44px] max-h-40 flex-1 resize-none rounded-md border border-neutral-700 bg-[#2a2a2b] px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:border-blue-500"
            placeholder={agentMode ? "やりたいことを指示…（@ でファイルを添付）" : "メッセージを入力…"}
            value={input}
            rows={1}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={busy}
          />
          {busy ? (
            <button
              onClick={handleStop}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500"
            >
              停止
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              送信
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

export default ChatPane;
