import { useEffect, useRef, useState } from "react";
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
  listShells,
  type ShellInfo,
} from "../lib/terminal";
import { getTerminalShell, setTerminalShell } from "../lib/agentSettings";

interface TerminalPanelProps {
  cwd: string | null;
  onClose: () => void;
}

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** One PTY-backed terminal session (xterm.js). Kept mounted; hidden when inactive. */
function TerminalView({ id, cwd, active }: { id: string; cwd: string | null; active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'ui-monospace, "Cascadia Code", "Consolas", monospace',
      cursorBlink: true,
      scrollback: 10000, // keep plenty of history scrollable
      theme: { background: "#121214", foreground: "#e5e5e5" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    // Clipboard: Ctrl/Cmd+Shift+C/V always copy/paste; bare Ctrl+C copies only
    // when there's a selection (otherwise it must pass through as SIGINT);
    // Ctrl+V / Shift+Insert paste. Returning false stops xterm from forwarding.
    const copySelection = () => {
      const sel = term.getSelection();
      if (sel) navigator.clipboard.writeText(sel).catch(() => {});
      return !!sel;
    };
    const paste = () =>
      navigator.clipboard.readText().then((t) => t && term.paste(t)).catch(() => {});
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && k === "c") {
        copySelection();
        return false;
      }
      if ((mod && e.shiftKey && k === "v") || (e.shiftKey && e.key === "Insert")) {
        paste();
        return false;
      }
      if (mod && !e.shiftKey && k === "c") {
        if (copySelection()) {
          term.clearSelection();
          return false; // copied a selection — don't send SIGINT
        }
        return true; // no selection → let Ctrl+C interrupt
      }
      if (mod && !e.shiftKey && k === "v") {
        paste();
        return false;
      }
      return true;
    });

    // Right-click: copy the selection if any, else paste (Windows-Terminal style).
    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
      const sel = term.getSelection();
      if (sel) {
        navigator.clipboard.writeText(sel).catch(() => {});
        term.clearSelection();
      } else {
        paste();
      }
    };
    host.addEventListener("contextmenu", onCtx);

    let unOut: (() => void) | undefined;
    let unExit: (() => void) | undefined;
    let disposed = false;
    onTerminalOutput((sid, b64) => {
      if (sid === id) term.write(decode(b64));
    }).then((u) => (disposed ? u() : (unOut = u)));
    onTerminalExit((sid) => {
      if (sid === id) term.write("\r\n\x1b[90m[プロセスが終了しました]\x1b[0m\r\n");
    }).then((u) => (disposed ? u() : (unExit = u)));

    terminalStart(id, cwd, term.rows, term.cols, getTerminalShell() || null).catch((e) =>
      term.write(`\r\n[ターミナル起動エラー] ${e}\r\n`),
    );

    const dataDisp = term.onData((d) => {
      terminalWrite(id, d).catch(() => {});
    });
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        terminalResize(id, term.rows, term.cols).catch(() => {});
      } catch {
        /* ignore transient layout */
      }
    });
    ro.observe(host);

    return () => {
      disposed = true;
      host.removeEventListener("contextmenu", onCtx);
      ro.disconnect();
      dataDisp.dispose();
      unOut?.();
      unExit?.();
      terminalKill(id).catch(() => {});
      term.dispose();
    };
  }, [id, cwd]);

  // Re-fit when this tab becomes visible (a hidden container has no size).
  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
        const t = termRef.current;
        if (t) terminalResize(id, t.rows, t.cols).catch(() => {});
        t?.focus();
      } catch {
        /* ignore */
      }
    });
  }, [active, id]);

  return <div ref={hostRef} className={"h-full w-full " + (active ? "" : "hidden")} />;
}

let termCounter = 1;

/** Bottom terminal panel with multiple session tabs. */
export default function TerminalPanel({ cwd, onClose }: TerminalPanelProps) {
  const [tabs, setTabs] = useState<{ id: string; name: string }[]>(() => [
    { id: crypto.randomUUID(), name: `ターミナル ${termCounter}` },
  ]);
  const [activeId, setActiveId] = useState(() => tabs[0].id);
  const [split, setSplit] = useState(false);
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [shellPref, setShellPref] = useState(() => getTerminalShell());

  useEffect(() => {
    listShells()
      .then(setShells)
      .catch(() => setShells([]));
  }, []);

  function addTab() {
    termCounter += 1;
    const t = { id: crypto.randomUUID(), name: `ターミナル ${termCounter}` };
    setTabs((prev) => [...prev, t]);
    setActiveId(t.id);
  }

  function closeTab(id: string) {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) {
        onClose();
        return prev;
      }
      if (id === activeId) setActiveId(next[next.length - 1].id);
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col border-t border-neutral-800 bg-[#121214]">
      <div className="flex items-center gap-1 border-b border-neutral-800 bg-[#1b1b1c] px-2 py-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">ターミナル</span>
        <div className="ml-2 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <span
              key={t.id}
              onClick={() => setActiveId(t.id)}
              className={
                "group flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-[11px] " +
                (t.id === activeId ? "bg-neutral-700 text-neutral-100" : "text-neutral-400 hover:bg-neutral-800")
              }
            >
              {t.name}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
                title="閉じる"
                className="rounded text-neutral-500 opacity-0 hover:text-neutral-200 group-hover:opacity-100"
              >
                ✕
              </button>
            </span>
          ))}
          <button onClick={addTab} title="ターミナルを追加" className="rounded px-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200">
            ＋
          </button>
        </div>
        <select
          value={shellPref}
          onChange={(e) => {
            setShellPref(e.target.value);
            setTerminalShell(e.target.value);
          }}
          title="新しく開くターミナルから適用されます"
          className="rounded border border-neutral-700 bg-[#1b1b1c] px-1 py-0.5 text-[11px] text-neutral-300 hover:bg-neutral-800"
        >
          <option value="">自動（既定）</option>
          {shells.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => setSplit((v) => !v)}
          title={split ? "タブ表示に戻す" : "分割表示（横並び）"}
          className={
            "rounded px-1.5 py-0.5 text-[11px] hover:bg-neutral-700 " +
            (split ? "text-blue-400" : "text-neutral-400 hover:text-neutral-200")
          }
        >
          ⫿ 分割
        </button>
        <button
          onClick={onClose}
          title="パネルを閉じる (Ctrl+J)"
          className="rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
        >
          ✕
        </button>
      </div>
      <div className={"min-h-0 flex-1 " + (split ? "flex" : "relative")}>
        {tabs.map((t) => (
          <div
            key={t.id}
            className={
              split
                ? "relative min-w-0 flex-1 border-r border-neutral-800 px-1 py-0.5"
                : "absolute inset-0 px-1 py-0.5 " + (t.id === activeId ? "" : "hidden")
            }
          >
            <TerminalView id={t.id} cwd={cwd} active={split || t.id === activeId} />
          </div>
        ))}
      </div>
    </div>
  );
}
