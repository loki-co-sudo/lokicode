import { useCallback, useEffect, useState } from "react";
import { listDir, joinPath, fileNameFromPath, type DirEntry } from "../lib/files";
import { gitStatus } from "../lib/git";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      className={"transition-transform " + (open ? "rotate-90" : "")}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7aa6da" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {open ? (
        <path d="M3 7h6l2 2h8a1 1 0 0 1 1 1H4l-1 7zM3 7v10a1 1 0 0 0 1 1h15" />
      ) : (
        <path d="M3 7h6l2 2h10v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      )}
    </svg>
  );
}

function fileColor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext)) return "#e2c08d";
  if (["rs"].includes(ext)) return "#d19a66";
  if (["json", "lock", "toml", "yml", "yaml"].includes(ext)) return "#c0c781";
  if (["css", "scss", "html"].includes(ext)) return "#7aa6da";
  if (["md", "txt"].includes(ext)) return "#9aa0a6";
  if (["png", "jpg", "jpeg", "svg", "gif", "ico"].includes(ext)) return "#b48ead";
  return "#8c919a";
}

function FileIcon({ name }: { name: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={fileColor(name)} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2h8l4 4v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
      <path d="M14 2v5h5" />
    </svg>
  );
}

function gitColor(letter: string): string {
  if (letter === "D") return "text-red-400";
  if (letter === "A" || letter === "?") return "text-emerald-400";
  if (letter === "R") return "text-blue-400";
  return "text-amber-400";
}

function relPath(abs: string, root: string): string {
  return abs.slice(root.length).replace(/^[\\/]+/, "").replace(/\\/g, "/");
}

interface TreeNodeProps {
  path: string;
  name: string;
  isDir: boolean;
  depth: number;
  root: string;
  activePath: string | null;
  gitMap: Map<string, string>;
  onOpenFile: (path: string) => void;
}

function TreeNode({ path, name, isDir, depth, root, activePath, gitMap, onOpenFile }: TreeNodeProps) {
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
  const letter = isDir ? "" : gitMap.get(relPath(path, root)) ?? "";

  return (
    <div>
      <div
        onClick={toggle}
        title={path}
        style={{ paddingLeft: depth * 12 + 6 }}
        className={
          "flex cursor-pointer items-center gap-1 py-[3px] pr-2 text-[13px] " +
          (active ? "bg-blue-600/25 text-neutral-100" : "text-neutral-300 hover:bg-neutral-800")
        }
      >
        <span className="flex w-3 shrink-0 justify-center text-neutral-500">
          {isDir && <Chevron open={open} />}
        </span>
        <span className="flex shrink-0 items-center">
          {isDir ? <FolderIcon open={open} /> : <FileIcon name={name} />}
        </span>
        <span className={"truncate " + (letter ? gitColor(letter) : "")}>{name}</span>
        {letter && <span className={"ml-auto pl-1 font-mono text-[11px] " + gitColor(letter)}>{letter}</span>}
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
              root={root}
              activePath={activePath}
              gitMap={gitMap}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** One workspace root: collapsible header + its tree with Git status colors. */
function RootSection({
  root,
  activePath,
  removable,
  onOpenFile,
  onRemove,
}: {
  root: string;
  activePath: string | null;
  removable: boolean;
  onOpenFile: (path: string) => void;
  onRemove: (root: string) => void;
}) {
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [gitMap, setGitMap] = useState<Map<string, string>>(new Map());
  const [open, setOpen] = useState(true);

  useEffect(() => {
    listDir(root)
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [root]);

  const reloadGit = useCallback(() => {
    gitStatus(root)
      .then((s) => {
        const m = new Map<string, string>();
        for (const f of s.files) {
          m.set(f.path, f.untracked ? "?" : (f.worktree !== " " ? f.worktree : f.index) || "M");
        }
        setGitMap(m);
      })
      .catch(() => setGitMap(new Map()));
  }, [root]);

  useEffect(() => {
    reloadGit();
  }, [reloadGit, activePath]);

  return (
    <div className="mb-0.5">
      <div className="group flex items-center gap-1 px-1 py-0.5">
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-1" title={root}>
          <span className="text-neutral-500">
            <Chevron open={open} />
          </span>
          <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            {fileNameFromPath(root) || root}
          </span>
        </button>
        {removable && (
          <button
            onClick={() => onRemove(root)}
            title="ワークスペースから除外"
            className="rounded px-1 text-neutral-500 opacity-0 hover:text-neutral-200 group-hover:opacity-100"
          >
            ✕
          </button>
        )}
      </div>
      {open && (
        <div>
          {entries === null && <div className="px-3 py-1 text-xs text-neutral-600">読み込み中…</div>}
          {entries?.length === 0 && <div className="px-3 py-1 text-xs text-neutral-600">空のフォルダ</div>}
          {entries?.map((e) => (
            <TreeNode
              key={e.name}
              path={joinPath(root, e.name)}
              name={e.name}
              isDir={e.isDir}
              depth={0}
              root={root}
              activePath={activePath}
              gitMap={gitMap}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ExplorerPaneProps {
  roots: string[];
  activePath: string | null;
  onOpenFile: (path: string) => void;
  onOpenFolder: () => void;
  onAddFolder: () => void;
  onRemoveRoot: (root: string) => void;
  onClose: () => void;
}

export default function ExplorerPane({
  roots,
  activePath,
  onOpenFile,
  onOpenFolder,
  onAddFolder,
  onRemoveRoot,
  onClose,
}: ExplorerPaneProps) {
  return (
    <div className="flex h-full flex-col bg-[#1b1b1c]">
      <div className="flex items-center justify-between border-b border-neutral-800 bg-[#252526] px-2 py-2">
        <span className="truncate text-xs font-medium uppercase tracking-wide text-neutral-400">
          エクスプローラ
        </span>
        <span className="flex items-center gap-1">
          <button onClick={onAddFolder} title="フォルダをワークスペースに追加" className="rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button onClick={onOpenFolder} title="フォルダを開く（置き換え）" className="rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200">
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
        {roots.map((r) => (
          <RootSection
            key={r}
            root={r}
            activePath={activePath}
            removable={roots.length > 1}
            onOpenFile={onOpenFile}
            onRemove={onRemoveRoot}
          />
        ))}
      </div>
    </div>
  );
}
