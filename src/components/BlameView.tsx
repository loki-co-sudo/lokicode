import { useEffect, useState } from "react";
import { gitBlame, type GitBlameLine } from "../lib/git";
import { readFile, fileNameFromPath } from "../lib/files";

interface BlameViewProps {
  cwd: string;
  path: string;
  onClose: () => void;
}

/** Read-only per-line `git blame` view: hash + author alongside the code. */
export default function BlameView({ cwd, path, onClose }: BlameViewProps) {
  const [lines, setLines] = useState<GitBlameLine[] | null>(null);
  const [code, setCode] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLines(null);
    setError(null);
    Promise.all([gitBlame(cwd, path), readFile(path).catch(() => "")])
      .then(([bl, text]) => {
        if (cancelled) return;
        setLines(bl);
        setCode(text.replace(/\n$/, "").split("\n"));
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [cwd, path]);

  return (
    <div className="flex h-full flex-col bg-[#1e1e1e]">
      <div className="flex items-center gap-2 border-b border-neutral-800 bg-[#2d2d2d] px-3 py-1.5 text-xs">
        <span className="font-mono text-neutral-200">git blame</span>
        <span className="truncate text-neutral-500">{fileNameFromPath(path)}</span>
        <button onClick={onClose} title="閉じる" className="ml-auto rounded px-2 py-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100">
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-relaxed">
        {error && <div className="p-2 text-red-400">{error}</div>}
        {!error && lines === null && <div className="p-2 text-neutral-500">読み込み中…</div>}
        {!error &&
          lines?.map((b, i) => (
            <div key={i} className="flex hover:bg-neutral-800/60">
              <span
                className="w-44 shrink-0 truncate border-r border-neutral-800 px-2 text-neutral-500"
                title={b.summary}
              >
                <span className="text-amber-500/80">{b.short}</span> {b.author}
              </span>
              <span className="w-10 shrink-0 px-1 text-right text-neutral-600">{b.line}</span>
              <span className="whitespace-pre-wrap px-2 text-neutral-300">{code[i] ?? ""}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
