import { useEffect, useState } from "react";
import { listDir, joinPath, fileNameFromPath, type DirEntry } from "../lib/files";

interface TreeNodeProps {
  path: string;
  name: string;
  isDir: boolean;
  depth: number;
  activePath: string | null;
  onOpenFile: (path: string) => void;
}

function TreeNode({ path, name, isDir, depth, activePath, onOpenFile }: TreeNodeProps) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (!isDir) {
      onOpenFile(path);
      return;
    }
    if (!open && children === null) {
      setLoading(true);
      try {
        setChildren(await listDir(path));
      } catch {
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
    setOpen((o) => !o);
  }

  const active = !isDir && activePath === path;

  return (
    <div>
      <div
        onClick={toggle}
        title={path}
        style={{ paddingLeft: depth * 12 + 8 }}
        className={
          "flex cursor-pointer items-center gap-1 py-0.5 pr-2 text-xs " +
          (active ? "bg-neutral-700 text-neutral-100" : "text-neutral-300 hover:bg-neutral-800")
        }
      >
        <span className="w-3 text-neutral-500">{isDir ? (open ? "▾" : "▸") : ""}</span>
        <span className="truncate">{isDir ? "📁" : "📄"} {name}</span>
      </div>
      {isDir && open && (
        <div>
          {loading && (
            <div style={{ paddingLeft: (depth + 1) * 12 + 8 }} className="py-0.5 text-xs text-neutral-600">
              読み込み中…
            </div>
          )}
          {children?.map((c) => (
            <TreeNode
              key={c.name}
              path={joinPath(path, c.name)}
              name={c.name}
              isDir={c.isDir}
              depth={depth + 1}
              activePath={activePath}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ExplorerPaneProps {
  root: string;
  activePath: string | null;
  onOpenFile: (path: string) => void;
  onOpenFolder: () => void;
  onClose: () => void;
}

export default function ExplorerPane({
  root,
  activePath,
  onOpenFile,
  onOpenFolder,
  onClose,
}: ExplorerPaneProps) {
  const [entries, setEntries] = useState<DirEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDir(root)
      .then((e) => !cancelled && setEntries(e))
      .catch(() => !cancelled && setEntries([]));
    return () => {
      cancelled = true;
    };
  }, [root]);

  return (
    <div className="flex h-full flex-col bg-[#1b1b1c]">
      <div className="flex items-center justify-between border-b border-neutral-800 bg-[#252526] px-2 py-2">
        <span className="truncate text-xs font-medium uppercase tracking-wide text-neutral-400" title={root}>
          {fileNameFromPath(root) || root}
        </span>
        <span className="flex items-center gap-1">
          <button onClick={onOpenFolder} title="別のフォルダを開く" className="rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7h6l2 2h10v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
            </svg>
          </button>
          <button onClick={onClose} title="エクスプローラを閉じる" className="rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {entries === null && <div className="px-3 py-1 text-xs text-neutral-600">読み込み中…</div>}
        {entries?.length === 0 && <div className="px-3 py-1 text-xs text-neutral-600">空のフォルダ</div>}
        {entries?.map((e) => (
          <TreeNode
            key={e.name}
            path={joinPath(root, e.name)}
            name={e.name}
            isDir={e.isDir}
            depth={0}
            activePath={activePath}
            onOpenFile={onOpenFile}
          />
        ))}
      </div>
    </div>
  );
}
