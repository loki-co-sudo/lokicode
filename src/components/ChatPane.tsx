import { useEffect, useRef, useState } from "react";
import {
  sendChat,
  hasApiKey,
  getModel,
  type ChatMessage,
} from "../lib/openrouter";

const SYSTEM_PROMPT: ChatMessage = {
  role: "system",
  content:
    "You are a helpful coding assistant embedded in a code editor. Be concise and use Markdown for code.",
};

export default function ChatPane() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const keyMissing = !hasApiKey();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, loading]);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    const userMessage: ChatMessage = { role: "user", content: text };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setError(null);
    setLoading(true);

    try {
      const reply = await sendChat([SYSTEM_PROMPT, ...nextMessages]);
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter to send, Shift+Enter for newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex h-full flex-col bg-[#1b1b1c]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 bg-[#252526] px-4 py-2">
        <span className="text-sm font-medium text-neutral-200">AI Chat</span>
        <span className="text-xs text-neutral-500">{getModel()}</span>
      </div>

      {keyMissing && (
        <div className="m-3 rounded-md border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
          API key not set. Copy <code>.env.example</code> to <code>.env</code> and
          set <code>VITE_OPENROUTER_API_KEY</code>, then restart the dev server.
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="mt-8 text-center text-sm text-neutral-600">
            Ask the AI anything about your code.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={
                "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm " +
                (m.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-neutral-800 text-neutral-100")
              }
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-400">
              Thinking…
            </div>
          </div>
        )}
        {error && (
          <div className="rounded-md border border-red-800/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-neutral-800 p-3">
        <div className="flex items-end gap-2">
          <textarea
            className="min-h-[44px] max-h-40 flex-1 resize-none rounded-md border border-neutral-700 bg-[#2a2a2b] px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:border-blue-500"
            placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
