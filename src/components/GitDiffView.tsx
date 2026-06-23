import { useEffect, useState } from "react";
import { gitDiff } from "../lib/git";
import { fileNameFromPath, joinPath } from "../lib/files";

export interface DiffTarget {
  /** Repo-relative path. */
  path: string;
  /** Diff against HEAD (staged) vs against index (unstaged). */
  staged: boolean;
}

interface GitDiffViewProps {
  root: string;
  target: DiffTarget;
  /** Open the file in the editor instead of viewing its diff. */
  onOpenFile: (path: string) => void;
  onClose: () => void;
}

function lineClass(line: string): string {
  if (line.startsWith("@@")) return "text-cyan-400";
  if (line.startsWith("+++") || line.startsWith("---")) return "text-neutral-500";
  if (line.startsWith("+")) return "bg-emerald-900/30 text-emerald-300";
  if (line.startsWith("-")) return "bg-red-900/30 text-red-300";
  if (line.startsWith("diff ") || line.startsWith("index ")) return "text-neutral-600";
  return "text-neutral-400";
}

/** Read-only viewer for a single file's git diff (unified format). */
export default function GitDiffView({ root, target, onOpenFile, onClose }: GitDiffViewProps) {
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDiff(null);
    setError(null);
    gitDiff(root, target.path, target.staged)
      .then((d) => !cancelled && setDiff(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [root, target.path, target.staged]);

  const absPath = joinPath(root, target.path);

  return (
    <div className="flex h-full flex-col bg-[#1e1e1e]">
      <div className="flex items-center gap-2 border-b border-neutral-800 bg-[#2d2d2d] px-3 py-1.5 text-xs">
        <span className="font-mono text-neutral-200">{fileNameFromPath(target.path)}</span>
        <span className="truncate text-neutral-600">{target.path}</span>
        <span className="rounded bg-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-300">
          {target.staged ? "ステージ済み" : "変更"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => onOpenFile(absPath)}
            className="rounded px-2 py-0.5 text-neutral-300 hover:bg-neutral-700"
            title="ファイルを開く"
          >
            ファイルを開く
          </button>
          <button
            onClick={onClose}
            className="rounded px-2 py-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100"
            title="差分を閉じる"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[12px] leading-relaxed">
        {error && <div className="text-red-400">{error}</div>}
        {!error && diff === null && <div className="text-neutral-500">差分を読み込み中…</div>}
        {!error && diff !== null && diff.trim() === "" && (
          <div className="text-neutral-500">差分はありません。</div>
        )}
        {!error &&
          diff !== null &&
          diff.length > 0 &&
          diff.replace(/\n$/, "").split("\n").map((line, i) => (
            <div key={i} className={"whitespace-pre-wrap " + lineClass(line)}>
              {line || " "}
            </div>
          ))}
      </div>
    </div>
  );
}
