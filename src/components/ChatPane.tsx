import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  streamChat,
  getSettings,
  saveSettings,
  type ApiMessage,
  type ChatMessage,
} from "../lib/openrouter";
import {
  runAgent,
  type AgentItem,
  type ToolStatus,
} from "../lib/agent";
import { runRecurrentReasoning, MAX_DEPTH } from "../lib/reasoning";
import { loadItems, saveItems, clearItems } from "../lib/chatStorage";
import Markdown from "./Markdown";
import ModelPicker from "./ModelPicker";

interface ChatPaneProps {
  onOpenSettings: () => void;
  settingsVersion: number;
  currentCode: string;
  currentFileName: string;
  currentFilePath: string | null;
}

export interface ChatPaneHandle {
  prefill: (text: string) => void;
}

interface PendingApproval {
  name: string;
  args: Record<string, unknown>;
  resolve: (ok: boolean) => void;
}

function buildSystemPrompt(fileName: string, filePath: string | null): ApiMessage {
  return {
    role: "system",
    content: `You are lokicode's coding agent embedded in a desktop code editor running on Windows (shell: cmd).
You can use the provided tools to read/list/write files and run shell commands to actually accomplish the user's request — not just describe it.
Guidelines:
- Use absolute Windows paths.
- Read files before editing them; after changes you may verify by reading files or running commands.
- write_file and run_command require the user's approval; if a call is denied, propose an alternative.
- Be concise. Reply in the user's language (Japanese if they write Japanese) and use Markdown.
${filePath ? `The user's active file is: ${filePath}` : `The active editor tab is unsaved (named "${fileName}").`}`,
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
  return <span className={"text-[11px] " + cls}>{label}</span>;
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

const ChatPane = forwardRef<ChatPaneHandle, ChatPaneProps>(function ChatPane(
  { onOpenSettings, settingsVersion, currentCode, currentFileName, currentFilePath },
  ref,
) {
  const [items, setItems] = useState<AgentItem[]>(() => loadItems());
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(true);
  const [model, setModel] = useState("");
  const [thinkingModel, setThinkingModel] = useState("");
  const [synthesisModel, setSynthesisModel] = useState("");
  const [includeFile, setIncludeFile] = useState(false);
  const [agentMode, setAgentMode] = useState(true);
  const [autoApprove, setAutoApprove] = useState(false);
  const [deepReasoning, setDeepReasoning] = useState(false);
  const [depth, setDepth] = useState<number>(() => {
    const v = Number(localStorage.getItem("lokicode.depth"));
    return v >= 1 && v <= MAX_DEPTH ? v : 4;
  });
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
    saveItems(items);
  }, [items]);

  useEffect(() => {
    localStorage.setItem("lokicode.depth", String(depth));
  }, [depth]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [items, busy, pending]);

  function appendItem(item: AgentItem) {
    setItems((prev) => [...prev, item]);
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

  function handleClear() {
    setItems([]);
    clearItems();
    setError(null);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || busy) return;

    const history = historyFromItems(items);
    appendItem({ kind: "user", content: text });
    setInput("");
    setError(null);
    setBusy(true);

    const base: ApiMessage[] = [buildSystemPrompt(currentFileName, currentFilePath)];
    if (includeFile && currentCode.trim()) {
      base.push({
        role: "system",
        content: `Current contents of the active file "${currentFileName}":\n\n\`\`\`\n${currentCode}\n\`\`\``,
      });
    }
    base.push(...history, { role: "user", content: text });

    try {
      if (deepReasoning) {
        await runRecurrentReasoning(
          base,
          { depth, thinkingModel: thinkingModel || undefined, synthesisModel: synthesisModel || undefined },
          {
            onThought: (label, m, content) =>
              appendItem({ kind: "thought", label, model: m, content }),
            onFinal: (text) => appendItem({ kind: "assistant", content: text }),
          },
        );
      } else if (agentMode) {
        await runAgent(
          base,
          {
            onAssistantText: (t) => appendItem({ kind: "assistant", content: t }),
            onToolStart: ({ name, args }) =>
              appendItem({ kind: "tool", name, args, status: "running" }),
            onToolEnd: (status, result) => updateLastTool(status, result),
            approve: (name, args) =>
              new Promise<boolean>((resolve) => setPending({ name, args, resolve })),
          },
          { autoApprove },
        );
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
      setBusy(false);
      setPending(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function resolveApproval(ok: boolean) {
    pending?.resolve(ok);
    setPending(null);
  }

  return (
    <div className="flex h-full flex-col bg-[#1b1b1c]">
      <div className="flex items-center gap-2 border-b border-neutral-800 bg-[#252526] px-3 py-2">
        <span className="text-sm font-medium text-neutral-200">AI Agent</span>
        <ModelPicker value={model} onChange={handleModelChange} listId="header-models" className="min-w-0 flex-1" />
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
          const isUser = it.kind === "user";
          return (
            <div key={i} className={isUser ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  "max-w-[85%] rounded-lg px-3 py-2 " +
                  (isUser
                    ? "whitespace-pre-wrap bg-blue-600 text-sm text-white"
                    : "bg-neutral-800 text-neutral-100")
                }
              >
                {isUser ? it.content : <Markdown content={it.content} />}
              </div>
            </div>
          );
        })}
        {busy && !pending && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-400">…</div>
          </div>
        )}
        {error && (
          <div className="rounded-md border border-red-800/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
      </div>

      {pending && (
        <div className="mx-3 mb-2 rounded-md border border-amber-600/60 bg-amber-950/30 p-3 text-xs">
          <p className="mb-1 font-medium text-amber-300">
            AI が次の操作を実行しようとしています（{toolLabel(pending.name)}）
          </p>
          <pre className="mb-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-[11px] text-neutral-200">
            {pending.name === "run_command"
              ? String(pending.args.command ?? "")
              : JSON.stringify(pending.args, null, 2)}
          </pre>
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
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-400">
          <label className="flex items-center gap-1.5" title="再帰深度ループで思考を反復してから回答します">
            <input type="checkbox" checked={deepReasoning} onChange={(e) => setDeepReasoning(e.target.checked)} className="accent-indigo-500" />
            🧠 ディープ推論
          </label>
          {deepReasoning ? (
            <label className="flex items-center gap-1.5" title="内省（自己検証）の反復回数。多いほど高品質・高コスト">
              思考深度
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
          ) : (
            <>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={agentMode} onChange={(e) => setAgentMode(e.target.checked)} className="accent-blue-600" />
                エージェント（ツール使用）
              </label>
              <label className="flex items-center gap-1.5" title="承認なしで書き込み・コマンドを実行します（注意）">
                <input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} disabled={!agentMode} className="accent-amber-500" />
                自動承認
              </label>
            </>
          )}
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={includeFile} onChange={(e) => setIncludeFile(e.target.checked)} className="accent-blue-600" />
            現在のファイルを文脈に含める
          </label>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            className="min-h-[44px] max-h-40 flex-1 resize-none rounded-md border border-neutral-700 bg-[#2a2a2b] px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:border-blue-500"
            placeholder={agentMode ? "やりたいことを指示…（例: index.js に関数を追加して）" : "メッセージを入力…"}
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={busy}
          />
          <button
            onClick={handleSend}
            disabled={busy || !input.trim()}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            送信
          </button>
        </div>
      </div>
    </div>
  );
});

export default ChatPane;
