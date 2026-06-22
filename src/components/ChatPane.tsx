import { useEffect, useRef, useState } from "react";
import {
  streamChat,
  getSettings,
  saveSettings,
  type ChatMessage,
} from "../lib/openrouter";
import { loadMessages, saveMessages, clearMessages } from "../lib/chatStorage";
import Markdown from "./Markdown";
import ModelPicker from "./ModelPicker";

const SYSTEM_PROMPT: ChatMessage = {
  role: "system",
  content:
    "You are a helpful coding assistant embedded in a code editor. Be concise and use Markdown for code.",
};

interface ChatPaneProps {
  onOpenSettings: () => void;
  settingsVersion: number;
  currentCode: string;
  currentFileName: string;
}

export default function ChatPane({
  onOpenSettings,
  settingsVersion,
  currentCode,
  currentFileName,
}: ChatPaneProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages());
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(true);
  const [model, setModel] = useState("");
  const [includeFile, setIncludeFile] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setHasKey(s.hasKey);
        setModel(s.model);
      })
      .catch(() => {});
  }, [settingsVersion]);

  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming]);

  async function handleModelChange(id: string) {
    setModel(id);
    try {
      await saveSettings(undefined, id);
    } catch {
      // ignore persistence errors
    }
  }

  function handleClear() {
    setMessages([]);
    clearMessages();
    setError(null);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;

    const userMessage: ChatMessage = { role: "user", content: text };
    const history = [...messages, userMessage];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setError(null);
    setStreaming(true);

    // Optionally prepend the current editor file as context (not shown in history).
    const payload: ChatMessage[] = [SYSTEM_PROMPT];
    if (includeFile && currentCode.trim()) {
      payload.push({
        role: "system",
        content: `The user is editing \`${currentFileName}\`. Current contents:\n\n\`\`\`\n${currentCode}\n\`\`\``,
      });
    }
    payload.push(...history);

    try {
      await streamChat(payload, (chunk) => {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = { ...last, content: last.content + chunk };
          }
          return next;
        });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.content === "") return prev.slice(0, -1);
        return prev;
      });
    } finally {
      setStreaming(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex h-full flex-col bg-[#1b1b1c]">
      <div className="flex items-center gap-2 border-b border-neutral-800 bg-[#252526] px-3 py-2">
        <span className="text-sm font-medium text-neutral-200">AI Chat</span>
        <ModelPicker
          value={model}
          onChange={handleModelChange}
          listId="header-models"
          className="min-w-0 flex-1"
        />
        <button
          onClick={handleClear}
          title="会話をクリア"
          className="rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          </svg>
        </button>
        <button
          onClick={onOpenSettings}
          title="設定"
          className="rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      {!hasKey && (
        <div className="m-3 rounded-md border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
          API キーが未設定です。
          <button onClick={onOpenSettings} className="ml-1 underline hover:text-amber-200">
            設定から入力
          </button>
          してください。
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="mt-8 text-center text-sm text-neutral-600">
            コードについて AI に質問できます。
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                "max-w-[85%] rounded-lg px-3 py-2 " +
                (m.role === "user"
                  ? "whitespace-pre-wrap bg-blue-600 text-sm text-white"
                  : "bg-neutral-800 text-neutral-100")
              }
            >
              {m.role === "assistant" ? (
                m.content ? (
                  <Markdown content={m.content} />
                ) : (
                  <span className="text-sm text-neutral-400">…</span>
                )
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}
        {error && (
          <div className="rounded-md border border-red-800/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
      </div>

      <div className="border-t border-neutral-800 p-3">
        <label className="mb-2 flex items-center gap-2 text-xs text-neutral-400">
          <input
            type="checkbox"
            checked={includeFile}
            onChange={(e) => setIncludeFile(e.target.checked)}
            className="accent-blue-600"
          />
          現在のファイル（{currentFileName}）を文脈に含める
        </label>
        <div className="flex items-end gap-2">
          <textarea
            className="min-h-[44px] max-h-40 flex-1 resize-none rounded-md border border-neutral-700 bg-[#2a2a2b] px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:border-blue-500"
            placeholder="メッセージを入力…（Enter で送信 / Shift+Enter で改行）"
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={streaming}
          />
          <button
            onClick={handleSend}
            disabled={streaming || !input.trim()}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            送信
          </button>
        </div>
      </div>
    </div>
  );
}
