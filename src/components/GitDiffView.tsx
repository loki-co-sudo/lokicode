import { useCallback, useEffect, useState } from "react";
import { gitDiff, gitApplyCached } from "../lib/git";
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

/** Split a unified diff into its file header and individual @@ hunks. */
function parseDiff(diff: string): { header: string; hunks: string[] } {
  const lines = diff.replace(/\n$/, "").split("\n");
  const first = lines.findIndex((l) => l.startsWith("@@"));
  if (first === -1) return { header: lines.join("\n"), hunks: [] };
  const header = lines.slice(0, first).join("\n");
  const hunks: string[] = [];
  let cur: string[] = [];
  for (const line of lines.slice(first)) {
    if (line.startsWith("@@")) {
      if (cur.length) hunks.push(cur.join("\n"));
      cur = [line];
    } else {
      cur.push(line);
    }
  }
  if (cur.length) hunks.push(cur.join("\n"));
  return { header, hunks };
}

/** Viewer for a single file's git diff, with per-hunk stage / unstage. */
export default function GitDiffView({ root, target, onOpenFile, onClose }: GitDiffViewProps) {
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setError(null);
    gitDiff(root, target.path, target.staged)
      .then(setDiff)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [root, target.path, target.staged]);

  useEffect(() => {
    setDiff(null);
    reload();
  }, [reload]);

  const absPath = joinPath(root, target.path);
  const parsed = diff ? parseDiff(diff) : null;

  async function applyHunk(hunk: string) {
    if (!parsed) return;
    const patch = parsed.header + "\n" + hunk + "\n";
    try {
      // staged view → reverse (unstage); unstaged view → stage.
      await gitApplyCached(root, patch, target.staged);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

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
        {error && <div className="mb-1 text-red-400">{error}</div>}
        {!error && diff === null && <div className="text-neutral-500">差分を読み込み中…</div>}
        {!error && parsed && parsed.hunks.length === 0 && (
          <div className="text-neutral-500">差分はありません。</div>
        )}
        {!error &&
          parsed?.hunks.map((hunk, hi) => (
            <div key={hi} className="mb-3">
              <div className="mb-0.5 flex items-center gap-2">
                <button
                  onClick={() => applyHunk(hunk)}
                  className="rounded bg-neutral-700 px-2 py-0.5 text-[10px] text-neutral-100 hover:bg-neutral-600"
                  title={target.staged ? "このハンクをアンステージ" : "このハンクをステージ"}
                >
                  {target.staged ? "− アンステージ" : "＋ ステージ"}
                </button>
              </div>
              {hunk.split("\n").map((line, i) => (
                <div key={i} className={"whitespace-pre-wrap " + lineClass(line)}>
                  {line || " "}
                </div>
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}
