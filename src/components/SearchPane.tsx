import { useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { grepSearch, replaceInFiles, type SearchMatch } from "../lib/search";
import { joinPath } from "../lib/files";

interface SearchPaneProps {
  root: string;
  onOpenFile: (path: string) => void;
}

interface FileGroup {
  path: string;
  matches: SearchMatch[];
}

/** Workspace-wide find (regex) and replace-all. */
export default function SearchPane({ root, onOpenFile }: SearchPaneProps) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [regex, setRegex] = useState(false);
  const [groups, setGroups] = useState<FileGroup[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function runSearch() {
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      // grep_search treats the pattern as a regex; escape it for literal mode.
      const pattern = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const hits = await grepSearch(root, pattern, 1000);
      const byFile = new Map<string, SearchMatch[]>();
      for (const h of hits) {
        const arr = byFile.get(h.path) ?? [];
        arr.push(h);
        byFile.set(h.path, arr);
      }
      setGroups([...byFile.entries()].map(([path, matches]) => ({ path, matches })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runReplace() {
    if (!query.trim()) return;
    const total = groups?.reduce((n, g) => n + g.matches.length, 0) ?? 0;
    const ok = await confirm(
      `「${query}」を「${replacement}」に全置換します（約 ${total} 箇所）。元に戻せません。続行しますか？`,
      { title: "一括置換", kind: "warning" },
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const r = await replaceInFiles(root, query, replacement, regex);
      setInfo(`${r.filesChanged} ファイル / ${r.replacements} 箇所を置換しました。`);
      await runSearch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const totalMatches = groups?.reduce((n, g) => n + g.matches.length, 0) ?? 0;

  return (
    <div className="flex h-full flex-col bg-[#1b1b1c]">
      <div className="border-b border-neutral-800 bg-[#252526] px-2 py-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
        検索 / 置換
      </div>

      <div className="space-y-1 border-b border-neutral-800 p-2">
        <div className="flex items-center gap-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder="検索"
            spellCheck={false}
            className="min-w-0 flex-1 rounded border border-neutral-700 bg-[#2a2a2b] px-2 py-1 text-xs text-neutral-100 outline-none focus:border-blue-500"
          />
          <button
            onClick={() => setRegex((v) => !v)}
            title="正規表現"
            className={
              "rounded px-1.5 py-1 font-mono text-xs " +
              (regex ? "bg-blue-600/40 text-blue-200" : "text-neutral-400 hover:bg-neutral-700")
            }
          >
            .*
          </button>
        </div>
        <input
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
          placeholder="置換後"
          spellCheck={false}
          className="w-full rounded border border-neutral-700 bg-[#2a2a2b] px-2 py-1 text-xs text-neutral-100 outline-none focus:border-blue-500"
        />
        <div className="flex gap-1">
          <button
            onClick={runSearch}
            disabled={busy || !query.trim()}
            className="flex-1 rounded bg-neutral-700 px-2 py-1 text-xs text-neutral-100 hover:bg-neutral-600 disabled:opacity-40"
          >
            検索
          </button>
          <button
            onClick={runReplace}
            disabled={busy || !query.trim() || totalMatches === 0}
            className="flex-1 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
          >
            全置換
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1 text-xs">
        {error && <div className="mx-2 my-1 rounded bg-red-950/40 px-2 py-1 text-red-300">{error}</div>}
        {info && <div className="mx-2 my-1 rounded bg-emerald-950/40 px-2 py-1 text-emerald-300">{info}</div>}
        {groups !== null && (
          <div className="px-2 py-1 text-[11px] text-neutral-500">
            {totalMatches} 件 / {groups.length} ファイル
          </div>
        )}
        {groups?.map((g) => (
          <div key={g.path} className="mb-1">
            <div className="truncate px-2 py-0.5 font-medium text-neutral-300" title={g.path}>
              {g.path}
            </div>
            {g.matches.map((m, i) => (
              <button
                key={i}
                onClick={() => onOpenFile(joinPath(root, g.path))}
                className="block w-full truncate px-3 py-0.5 text-left text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
                title={m.text}
              >
                <span className="mr-2 text-neutral-600">{m.line}</span>
                {m.text.trim()}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
