import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  gitStatus,
  gitStage,
  gitUnstage,
  gitCommit,
  gitInit,
  type GitStatus,
  type GitFile,
} from "../lib/git";
import { fileNameFromPath, joinPath } from "../lib/files";

interface SourceControlPaneProps {
  root: string;
  onOpenFile: (path: string) => void;
}

function statusColor(letter: string): string {
  if (letter === "D") return "text-red-400";
  if (letter === "A" || letter === "?") return "text-emerald-400";
  if (letter === "R") return "text-blue-400";
  return "text-amber-400";
}

function Header({ branch, onRefresh }: { branch: string; onRefresh: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-neutral-800 bg-[#252526] px-2 py-2">
      <span className="truncate text-xs font-medium uppercase tracking-wide text-neutral-400">
        ソース管理{branch ? ` · ${branch}` : ""}
      </span>
      <button onClick={onRefresh} title="更新" className="rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200">
        ⟳
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-1">
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        {title}
      </div>
      {children}
    </div>
  );
}

export default function SourceControlPane({ root, onOpenFile }: SourceControlPaneProps) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setStatus(await gitStatus(root));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [root]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (status === null && !error) {
    return <div className="p-3 text-xs text-neutral-500">読み込み中…</div>;
  }

  if (status && !status.isRepo) {
    return (
      <div className="flex h-full flex-col bg-[#1b1b1c]">
        <Header branch="" onRefresh={reload} />
        <div className="space-y-2 p-3 text-xs text-neutral-400">
          <p>このフォルダは Git リポジトリではありません。</p>
          <button
            onClick={() => act(() => gitInit(root))}
            disabled={busy}
            className="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-500 disabled:opacity-40"
          >
            git init で初期化
          </button>
          {error && <p className="text-red-400">{error}</p>}
        </div>
      </div>
    );
  }

  const files = status?.files ?? [];
  const staged = files.filter((f) => f.staged);
  const unstaged = files.filter((f) => !f.staged && !f.untracked);
  const untracked = files.filter((f) => f.untracked);

  function Row({ f, action }: { f: GitFile; action: "stage" | "unstage" }) {
    const letter = f.untracked ? "?" : f.staged ? f.index : f.worktree;
    return (
      <div className="group flex items-center gap-1 px-2 py-0.5 text-xs hover:bg-neutral-800">
        <button
          onClick={() => onOpenFile(joinPath(root, f.path))}
          className="min-w-0 flex-1 truncate text-left text-neutral-300"
          title={f.path}
        >
          {fileNameFromPath(f.path)} <span className="text-neutral-600">{f.path}</span>
        </button>
        <span className={"w-4 text-center font-mono " + statusColor(letter)}>{letter}</span>
        <button
          onClick={() => act(() => (action === "stage" ? gitStage(root, f.path) : gitUnstage(root, f.path)))}
          title={action === "stage" ? "ステージ" : "アンステージ"}
          className="rounded px-1 text-neutral-400 opacity-0 hover:bg-neutral-700 hover:text-neutral-100 group-hover:opacity-100"
        >
          {action === "stage" ? "＋" : "−"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#1b1b1c]">
      <Header branch={status?.branch ?? ""} onRefresh={reload} />

      <div className="border-b border-neutral-800 p-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="コミットメッセージ"
          rows={2}
          className="w-full resize-none rounded border border-neutral-700 bg-[#2a2a2b] px-2 py-1 text-xs text-neutral-100 outline-none focus:border-blue-500"
        />
        <button
          disabled={busy || !message.trim() || staged.length === 0}
          onClick={() => act(async () => { await gitCommit(root, message); setMessage(""); })}
          className="mt-1 w-full rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
        >
          ✓ コミット（ステージ済み {staged.length}）
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {error && (
          <div className="mx-2 my-1 rounded bg-red-950/40 px-2 py-1 text-[11px] text-red-300">{error}</div>
        )}
        {files.length === 0 && (
          <div className="px-3 py-2 text-xs text-neutral-600">変更はありません</div>
        )}
        {staged.length > 0 && (
          <Section title={`ステージ済み (${staged.length})`}>
            {staged.map((f) => (
              <Row key={f.path} f={f} action="unstage" />
            ))}
          </Section>
        )}
        {unstaged.length > 0 && (
          <Section title={`変更 (${unstaged.length})`}>
            {unstaged.map((f) => (
              <Row key={f.path} f={f} action="stage" />
            ))}
          </Section>
        )}
        {untracked.length > 0 && (
          <Section title={`追跡対象外 (${untracked.length})`}>
            {untracked.map((f) => (
              <Row key={f.path} f={f} action="stage" />
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}
