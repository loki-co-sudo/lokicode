import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  terminalStart,
  terminalWrite,
  terminalResize,
  terminalKill,
  onTerminalOutput,
  onTerminalExit,
} from "../lib/terminal";

interface TerminalPanelProps {
  cwd: string | null;
  onClose: () => void;
}

// Decode base64 (raw PTY bytes) to a Uint8Array for xterm.write.
function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Full PTY-backed terminal rendered with xterm.js (colors, TUIs, resize). */
export default function TerminalPanel({ cwd, onClose }: TerminalPanelProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'ui-monospace, "Cascadia Code", "Consolas", monospace',
      cursorBlink: true,
      theme: { background: "#121214", foreground: "#e5e5e5" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    let unlistenOut: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    let disposed = false;

    onTerminalOutput((b64) => term.write(decode(b64))).then((u) =>
      disposed ? u() : (unlistenOut = u),
    );
    onTerminalExit(() => {
      term.write("\r\n\x1b[90m[プロセスが終了しました]\x1b[0m\r\n");
    }).then((u) => (disposed ? u() : (unlistenExit = u)));

    terminalStart(cwd, term.rows, term.cols).catch((e) =>
      term.write(`\r\n[ターミナル起動エラー] ${e}\r\n`),
    );

    // Send user keystrokes to the PTY.
    const dataDisp = term.onData((d) => {
      terminalWrite(d).catch(() => {});
    });

    // Keep the PTY size in sync with the panel.
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        terminalResize(term.rows, term.cols).catch(() => {});
      } catch {
        /* ignore transient layout */
      }
    });
    ro.observe(host);

    term.focus();

    return () => {
      disposed = true;
      ro.disconnect();
      dataDisp.dispose();
      unlistenOut?.();
      unlistenExit?.();
      terminalKill().catch(() => {});
      term.dispose();
    };
  }, [cwd]);

  return (
    <div className="flex h-full flex-col border-t border-neutral-800 bg-[#121214]">
      <div className="flex items-center gap-2 border-b border-neutral-800 bg-[#1b1b1c] px-2 py-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
          ターミナル
        </span>
        <button
          onClick={onClose}
          title="ターミナルを閉じる (Ctrl+J)"
          className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
        >
          ✕
        </button>
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden px-1 py-0.5" />
    </div>
  );
}
