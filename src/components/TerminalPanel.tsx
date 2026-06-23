import { useEffect, useRef, useState } from "react";
import { terminalStart, terminalWrite, terminalKill, onTerminalOutput } from "../lib/terminal";

// Strip ANSI escape sequences (we render plain text, not a full TTY).
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

interface TerminalPanelProps {
  cwd: string | null;
  onClose: () => void;
}

/** Basic integrated terminal: a persistent shell with streamed output. */
export default function TerminalPanel({ cwd, onClose }: TerminalPanelProps) {
  const [output, setOutput] = useState("");
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    onTerminalOutput((chunk) => setOutput((o) => (o + chunk).slice(-100000))).then((un) => {
      if (cancelled) un();
      else unlisten = un;
    });
    terminalStart(cwd).catch((e) =>
      setOutput((o) => o + `\n[ターミナル起動エラー] ${e}\n`),
    );
    return () => {
      cancelled = true;
      unlisten?.();
      terminalKill().catch(() => {});
    };
    // Restart the shell when the workspace changes.
  }, [cwd]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [output]);

  function send() {
    const line = input;
    setOutput((o) => o + line + "\n"); // local echo (cmd /Q doesn't echo input)
    terminalWrite(line + "\r\n").catch(() => {});
    setInput("");
  }

  return (
    <div className="flex h-full flex-col border-t border-neutral-800 bg-[#121214]">
      <div className="flex items-center gap-2 border-b border-neutral-800 bg-[#1b1b1c] px-2 py-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">ターミナル</span>
        <button
          onClick={() => setOutput("")}
          title="クリア"
          className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
        >
          クリア
        </button>
        <button
          onClick={onClose}
          title="ターミナルを閉じる (Ctrl+J)"
          className="rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
        >
          ✕
        </button>
      </div>

      <div
        ref={scrollRef}
        onClick={() => inputRef.current?.focus()}
        className="min-h-0 flex-1 overflow-auto px-2 py-1 font-mono text-[12px] leading-snug text-neutral-200"
      >
        <pre className="whitespace-pre-wrap break-all">{output.replace(ANSI, "")}</pre>
        <div className="flex items-center gap-1">
          <span className="text-emerald-400">›</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                send();
              }
            }}
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-neutral-100 outline-none"
            placeholder="コマンドを入力して Enter…"
          />
        </div>
      </div>
    </div>
  );
}
