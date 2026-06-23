import { useEffect, useMemo, useRef, useState } from "react";

export interface Command {
  id: string;
  title: string;
  hint?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  mode: "command" | "file";
  commands: Command[];
  files: string[];
  onClose: () => void;
  onSelectFile: (relPath: string) => void;
}

/** Case-insensitive subsequence match (fuzzy), returns true if all chars of q appear in order. */
function fuzzy(q: string, text: string): boolean {
  if (!q) return true;
  const t = text.toLowerCase();
  let i = 0;
  for (const ch of q.toLowerCase()) {
    i = t.indexOf(ch, i);
    if (i === -1) return false;
    i++;
  }
  return true;
}

/** VS Code-style command palette + quick file open. */
export default function CommandPalette({
  open,
  mode,
  commands,
  files,
  onClose,
  onSelectFile,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // focus after mount
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, mode]);

  const items = useMemo(() => {
    if (mode === "command") {
      return commands.filter((c) => fuzzy(query, c.title)).map((c) => ({ key: c.id, title: c.title, hint: c.hint, run: c.run }));
    }
    const q = query.trim();
    return files
      .filter((f) => fuzzy(q, f))
      .slice(0, 200)
      .map((f) => ({
        key: f,
        title: f.split("/").pop() ?? f,
        hint: f,
        run: () => onSelectFile(f),
      }));
  }, [mode, commands, files, query, onSelectFile]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, items.length - 1)));
  }, [items.length]);

  if (!open) return null;

  function choose(i: number) {
    const it = items[i];
    if (!it) return;
    onClose();
    it.run();
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  // keep active item in view
  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div className="fixed inset-0 z-[60] flex justify-center bg-black/40 pt-[12vh]" onClick={onClose}>
      <div
        className="flex max-h-[60vh] w-[36rem] max-w-[92vw] flex-col overflow-hidden rounded-lg border border-neutral-700 bg-[#252526] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder={mode === "command" ? "コマンドを入力…" : "ファイル名で開く…"}
          spellCheck={false}
          className="border-b border-neutral-800 bg-[#1e1e1e] px-3 py-2 text-sm text-neutral-100 outline-none"
        />
        <div ref={listRef} className="min-h-0 flex-1 overflow-auto py-1">
          {items.length === 0 && (
            <div className="px-3 py-2 text-xs text-neutral-600">該当なし</div>
          )}
          {items.map((it, i) => (
            <button
              key={it.key}
              onClick={() => choose(i)}
              onMouseMove={() => setActive(i)}
              className={
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm " +
                (i === active ? "bg-blue-600/30 text-neutral-100" : "text-neutral-300")
              }
            >
              <span className="truncate">{it.title}</span>
              {it.hint && <span className="ml-auto truncate text-[11px] text-neutral-500">{it.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
