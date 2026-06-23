import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  gitStatus,
  gitStage,
  gitUnstage,
  gitCommit,
  gitInit,
  gitBranches,
  gitSwitch,
  gitCreateBranch,
  gitPull,
  gitPush,
  gitLog,
  type GitStatus,
  type GitFile,
  type GitCommit,
} from "../lib/git";
import { githubUser, type GithubUser } from "../lib/github";
import { fileNameFromPath } from "../lib/files";
import type { DiffTarget } from "./GitDiffView";

interface SourceControlPaneProps {
  root: string;
  onOpenDiff: (target: DiffTarget) => void;
}

function statusColor(letter: string): string {
  if (letter === "D") return "text-red-400";
  if (letter === "A" || letter === "?") return "text-emerald-400";
  if (letter === "R") return "text-blue-400";
  return "text-amber-400";
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

export default function SourceControlPane({ root, onOpenDiff }: SourceControlPaneProps) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [branchMenu, setBranchMenu] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  const [user, setUser] = useState<GithubUser | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [commits, setCommits] = useState<GitCommit[] | null>(null);

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
    githubUser().then(setUser).catch(() => setUser(null));
  }, [reload]);

  // Load history when the section is opened (and refresh on branch/commit changes).
  useEffect(() => {
    if (!showHistory) return;
    gitLog(root, 30)
      .then(setCommits)
      .catch(() => setCommits([]));
  }, [showHistory, root, status?.branch, status?.ahead]);

  // Close the branch menu on outside click.
  useEffect(() => {
    if (!branchMenu) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setBranchMenu(false);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [branchMenu]);

  const act = useCallback(
    async (fn: () => Promise<unknown>, successInfo?: string) => {
      setBusy(true);
      setError(null);
      setInfo(null);
      try {
        await fn();
        await reload();
        if (successInfo) setInfo(successInfo);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const openBranchMenu = useCallback(async () => {
    if (branchMenu) {
      setBranchMenu(false);
      return;
    }
    try {
      const b = await gitBranches(root);
      setBranches(b.branches);
      setBranchMenu(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [branchMenu, root]);

  const switchBranch = useCallback(
    (name: string) => {
      setBranchMenu(false);
      act(() => gitSwitch(root, name));
    },
    [act, root],
  );

  const createBranch = useCallback(() => {
    setBranchMenu(false);
    const name = window.prompt("新しいブランチ名");
    if (name && name.trim()) act(() => gitCreateBranch(root, name.trim()));
  }, [act, root]);

  if (status === null && !error) {
    return <div className="p-3 text-xs text-neutral-500">読み込み中…</div>;
  }

  if (status && !status.isRepo) {
    return (
      <div className="flex h-full flex-col bg-[#1b1b1c]">
        <div className="flex items-center justify-between border-b border-neutral-800 bg-[#252526] px-2 py-2">
          <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">ソース管理</span>
        </div>
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
  const branch = status?.branch ?? "";

  function Row({ f, action }: { f: GitFile; action: "stage" | "unstage" }) {
    const letter = f.untracked ? "?" : f.staged ? f.index : f.worktree;
    return (
      <div className="group flex items-center gap-1 px-2 py-0.5 text-xs hover:bg-neutral-800">
        <button
          onClick={() => onOpenDiff({ path: f.path, staged: f.staged })}
          className="min-w-0 flex-1 truncate text-left text-neutral-300"
          title={`差分を表示: ${f.path}`}
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
      {/* Header: branch selector + pull/push + refresh */}
      <div className="relative flex items-center gap-1 border-b border-neutral-800 bg-[#252526] px-2 py-2">
        <button
          onClick={openBranchMenu}
          disabled={busy}
          className="flex min-w-0 items-center gap-1 truncate rounded px-1 py-0.5 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-40"
          title="ブランチを切り替え"
        >
          <span className="text-neutral-500">⎇</span>
          <span className="truncate">{branch || "(ブランチなし)"}</span>
          <span className="text-[9px] text-neutral-500">▾</span>
        </button>

        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={() => act(() => gitPull(root), "pull しました")}
            disabled={busy || !status?.upstream}
            title="pull (ff-only)"
            className="rounded px-1 py-0.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100 disabled:opacity-30"
          >
            ↓{status && status.behind > 0 ? status.behind : ""}
          </button>
          <button
            onClick={() => act(() => gitPush(root), "push しました")}
            disabled={busy}
            title="push"
            className="rounded px-1 py-0.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100 disabled:opacity-40"
          >
            ↑{status && status.ahead > 0 ? status.ahead : ""}
          </button>
          <button
            onClick={reload}
            title="更新"
            className="rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
          >
            ⟳
          </button>
          {user && user.avatarUrl && (
            <img
              src={user.avatarUrl}
              alt={user.login}
              title={`@${user.login} でログイン中`}
              className="ml-0.5 h-5 w-5 rounded-full"
            />
          )}
        </div>

        {branchMenu && (
          <div
            ref={menuRef}
            className="absolute left-2 top-full z-10 mt-1 max-h-64 w-52 overflow-auto rounded border border-neutral-700 bg-[#2a2a2b] py-1 shadow-lg"
          >
            {branches.map((b) => (
              <button
                key={b}
                onClick={() => switchBranch(b)}
                className={
                  "block w-full truncate px-3 py-1 text-left text-xs hover:bg-neutral-700 " +
                  (b === branch ? "text-blue-400" : "text-neutral-300")
                }
              >
                {b === branch ? "● " : "　"}
                {b}
              </button>
            ))}
            <div className="my-1 border-t border-neutral-700" />
            <button
              onClick={createBranch}
              className="block w-full px-3 py-1 text-left text-xs text-emerald-400 hover:bg-neutral-700"
            >
              ＋ 新しいブランチ…
            </button>
          </div>
        )}
      </div>

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
        {info && !error && (
          <div className="mx-2 my-1 rounded bg-emerald-950/40 px-2 py-1 text-[11px] text-emerald-300">{info}</div>
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

        {/* Commit history (current repo) */}
        <div className="mt-1 border-t border-neutral-800 pt-1">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="flex w-full items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-300"
          >
            <span className="text-[9px]">{showHistory ? "▾" : "▸"}</span>
            コミット履歴
          </button>
          {showHistory && (
            <div>
              {commits === null && (
                <div className="px-3 py-1 text-xs text-neutral-600">読み込み中…</div>
              )}
              {commits !== null && commits.length === 0 && (
                <div className="px-3 py-1 text-xs text-neutral-600">コミットがありません</div>
              )}
              {commits?.map((c) => (
                <div
                  key={c.hash}
                  className="px-2 py-1 text-xs hover:bg-neutral-800"
                  title={`${c.hash}\n${c.author} · ${c.date}`}
                >
                  <div className="truncate text-neutral-300">{c.subject}</div>
                  <div className="flex gap-2 text-[10px] text-neutral-600">
                    <span className="font-mono text-amber-500/80">{c.short}</span>
                    <span className="truncate">{c.author}</span>
                    <span>{c.date}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
