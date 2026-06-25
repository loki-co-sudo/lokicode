import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { editor as MonacoEditor } from "monaco-editor";
import { usePersistentBool, usePersistentString } from "./lib/usePersistentState";
import EditorPane from "./components/EditorPane";
import ChatPane, { type ChatPaneHandle } from "./components/ChatPane";
import ErrorBoundary from "./components/ErrorBoundary";
import SettingsPane from "./components/SettingsPane";
import ExplorerPane from "./components/ExplorerPane";
import SourceControlPane from "./components/SourceControlPane";
import GitDiffView, { type DiffTarget } from "./components/GitDiffView";
import BlameView from "./components/BlameView";
import UpdateBanner from "./components/UpdateBanner";
import SearchPane from "./components/SearchPane";
import TerminalPanel from "./components/TerminalPanel";
import CommandPalette, { type Command } from "./components/CommandPalette";
import ActivityBar, { type SidebarView } from "./components/ActivityBar";
import {
  openFile,
  openFolder,
  readFile,
  writeFile,
  saveFileAs,
  fileNameFromPath,
  languageFromPath,
  joinPath,
} from "./lib/files";
import { listFiles } from "./lib/search";
import { addRecentFile, addRecentFolder, recentFolders } from "./lib/recent";
import { safeSetItem } from "./lib/chatStorage";
import { loadKeybindings, comboFromEvent, type ActionId } from "./lib/keybindings";

export interface Tab {
  id: string;
  name: string;
  path: string | null;
  language: string;
  content: string;
  dirty: boolean;
  pinned?: boolean;
}

let untitledCounter = 1;

function createTab(partial: Partial<Tab> = {}): Tab {
  return {
    id: crypto.randomUUID(),
    name: "untitled",
    path: null,
    language: "plaintext",
    content: "",
    dirty: false,
    ...partial,
  };
}

export default function App() {
  // Start with no open files; the editor shows an empty state until the user
  // opens or creates one (a sample file on launch only caused confusion).
  const [tabs, setTabs] = useState<Tab[]>(() => []);
  const [activeId, setActiveId] = useState("");

  const [settingsVersion, setSettingsVersion] = useState(0);

  // Open workspace folders (multi-root). The first is the "primary" root used by
  // Git / search / terminal / the agent; the explorer shows them all.
  const [workspaceRoots, setWorkspaceRoots] = useState<string[]>(() => {
    try {
      const arr = JSON.parse(localStorage.getItem("lokicode.workspaceRoots") ?? "null");
      if (Array.isArray(arr)) return arr.filter((x) => typeof x === "string");
    } catch {
      /* fall through */
    }
    const old = localStorage.getItem("lokicode.workspaceRoot"); // migrate single-root
    return old ? [old] : [];
  });
  useEffect(() => {
    safeSetItem("lokicode.workspaceRoots", JSON.stringify(workspaceRoots));
  }, [workspaceRoots]);
  const workspaceRoot = workspaceRoots[0] ?? null;
  const [sidebarView, setSidebarView] = useState<SidebarView>(() => {
    const s = localStorage.getItem("lokicode.sidebarView");
    return s === "explorer" || s === "search" || s === "git" ? s : null;
  });
  useEffect(() => {
    if (sidebarView) safeSetItem("lokicode.sidebarView", sidebarView);
    else localStorage.removeItem("lokicode.sidebarView");
  }, [sidebarView]);

  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  const [blamePath, setBlamePath] = useState<string | null>(null);
  // Left/right split editor: a second group with its own active tab.
  const [splitOn, setSplitOn] = useState(false);
  const [rightActiveId, setRightActiveId] = useState<string | null>(null);
  const [updateCheckNonce, setUpdateCheckNonce] = useState(0);
  // Bumped when the agent writes files so Git/Explorer panes re-read from disk.
  const [fsNonce, setFsNonce] = useState(0);
  // Whether the right-hand AI Agent pane is shown (collapsible like the sidebar).
  const [chatOpen, setChatOpen] = usePersistentBool("lokicode.chatOpen", true);
  // Bottom integrated terminal panel.
  const [terminalOpen, setTerminalOpen] = usePersistentBool("lokicode.terminalOpen", false);
  // Auto-save: debounced write of the active tab after edits.
  const [autoSave, setAutoSave] = usePersistentBool("lokicode.autoSave", false);
  // Remember the last non-null sidebar view so Ctrl+B can reopen it.
  const lastSidebarRef = useRef<Exclude<SidebarView, null>>("explorer");
  useEffect(() => {
    if (sidebarView) lastSidebarRef.current = sidebarView;
  }, [sidebarView]);

  // Color theme (dark default). Applied as the `light` class on <html>.
  const [theme, setTheme] = usePersistentString("lokicode.theme", "dark");
  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);

  // Command palette (Ctrl+Shift+P) and quick file open (Ctrl+P).
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<"command" | "file">("command");
  const [paletteFiles, setPaletteFiles] = useState<string[]>([]);

  const [editorPct, setEditorPct] = useState(62);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const chatRef = useRef<ChatPaneHandle>(null);
  const editorInstanceRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);

  // `activeTab` is undefined when no files are open (empty state).
  const activeTab: Tab | undefined = tabs.find((t) => t.id === activeId);
  const rightTab: Tab | undefined = tabs.find((t) => t.id === rightActiveId) ?? activeTab;

  const updateTab = useCallback((id: string, patch: Partial<Tab>) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const handleChange = useCallback(
    (value: string) => {
      updateTab(activeId, { content: value, dirty: true });
    },
    [activeId, updateTab],
  );

  const reorderTabs = useCallback((fromId: string, toId: string) => {
    setTabs((prev) => {
      const from = prev.findIndex((t) => t.id === fromId);
      const to = prev.findIndex((t) => t.id === toId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const togglePinTab = useCallback((id: string) => {
    setTabs((prev) => {
      const updated = prev.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t));
      // Keep pinned tabs grouped at the front, preserving relative order.
      return [...updated.filter((t) => t.pinned), ...updated.filter((t) => !t.pinned)];
    });
  }, []);

  const handleNewTab = useCallback(() => {
    const tab = createTab({ name: `untitled-${untitledCounter++}` });
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
  }, []);

  const handleOpen = useCallback(async () => {
    const file = await openFile();
    if (!file) return;
    // If already open, just activate it.
    const existing = tabs.find((t) => t.path === file.path);
    if (existing) {
      setActiveId(existing.id);
      return;
    }
    const tab = createTab({
      name: fileNameFromPath(file.path),
      path: file.path,
      language: languageFromPath(file.path),
      content: file.content,
    });
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
    addRecentFile(file.path);
  }, [tabs]);

  const openPath = useCallback(
    async (path: string) => {
      const existing = tabs.find((t) => t.path === path);
      if (existing) {
        setActiveId(existing.id);
        return;
      }
      let content: string;
      try {
        content = await readFile(path);
      } catch {
        return; // non-text / unreadable file
      }
      const tab = createTab({
        name: fileNameFromPath(path),
        path,
        language: languageFromPath(path),
        content,
      });
      setTabs((prev) => [...prev, tab]);
      setActiveId(tab.id);
      addRecentFile(path);
    },
    [tabs],
  );

  const handleQuickAction = useCallback(
    (action: "explain" | "refactor" | "test", code: string, language: string) => {
      const prompts: Record<typeof action, string> = {
        explain: "次のコードを分かりやすく説明してください",
        refactor: "次のコードをリファクタリングし、変更点を説明してください",
        test: "次のコードのテストを書いてください",
      };
      setChatOpen(true);
      const fence = language && language !== "plaintext" ? language : "";
      chatRef.current?.prefill(`${prompts[action]}:\n\n\`\`\`${fence}\n${code}\n\`\`\``);
    },
    [setChatOpen],
  );

  // Open a folder as the workspace (replaces the current set).
  const openFolderPath = useCallback((dir: string) => {
    setWorkspaceRoots([dir]);
    setSidebarView("explorer");
    addRecentFolder(dir);
  }, []);

  const handleOpenFolder = useCallback(async () => {
    const dir = await openFolder();
    if (dir) openFolderPath(dir);
  }, [openFolderPath]);

  // Add another folder to the multi-root workspace.
  const handleAddFolder = useCallback(async () => {
    const dir = await openFolder();
    if (!dir) return;
    setWorkspaceRoots((prev) => (prev.includes(dir) ? prev : [...prev, dir]));
    setSidebarView("explorer");
    addRecentFolder(dir);
  }, []);

  const removeRoot = useCallback((dir: string) => {
    setWorkspaceRoots((prev) => prev.filter((r) => r !== dir));
  }, []);

  const handleActivitySelect = useCallback((view: Exclude<SidebarView, null>) => {
    setSidebarView((cur) => (cur === view ? null : view));
  }, []);

  const handleSave = useCallback(async () => {
    const tab = tabs.find((t) => t.id === activeId);
    if (!tab) return;
    if (tab.path) {
      await writeFile(tab.path, tab.content);
      updateTab(tab.id, { dirty: false });
    } else {
      const path = await saveFileAs(tab.content, tab.name);
      if (!path) return;
      updateTab(tab.id, {
        path,
        name: fileNameFromPath(path),
        language: languageFromPath(path),
        dirty: false,
      });
    }
  }, [tabs, activeId, updateTab]);

  const handleCloseTab = useCallback(
    async (id: string) => {
      const tab = tabs.find((t) => t.id === id);
      if (!tab) return;
      if (tab.dirty) {
        const ok = await confirm(`「${tab.name}」には未保存の変更があります。閉じますか？`, {
          title: "未保存の変更",
          kind: "warning",
        });
        if (!ok) return;
      }
      setTabs((prev) => {
        const remaining = prev.filter((t) => t.id !== id);
        // Closing the last tab leaves an empty editor (no auto "untitled").
        if (id === activeId) {
          const idx = prev.findIndex((t) => t.id === id);
          const neighbor = remaining[Math.min(idx, remaining.length - 1)];
          setActiveId(neighbor?.id ?? "");
        }
        return remaining;
      });
    },
    [tabs, activeId],
  );

  const openPalette = useCallback(
    async (mode: "command" | "file") => {
      if (mode === "file") {
        if (!workspaceRoot) return;
        try {
          setPaletteFiles(await listFiles(workspaceRoot));
        } catch {
          setPaletteFiles([]);
        }
      }
      setPaletteMode(mode);
      setPaletteOpen(true);
    },
    [workspaceRoot],
  );

  const commands = useMemo<Command[]>(
    () => [
      { id: "open-folder", title: "フォルダを開く", hint: "Folder", run: handleOpenFolder },
      { id: "open-file", title: "ファイルを開く", hint: "Ctrl+O", run: handleOpen },
      { id: "quick-open", title: "ファイルへ移動（クイックオープン）", hint: "Ctrl+P", run: () => openPalette("file") },
      { id: "save", title: "保存", hint: "Ctrl+S", run: handleSave },
      { id: "new-tab", title: "新しいタブ", run: handleNewTab },
      { id: "view-explorer", title: "エクスプローラを表示", run: () => setSidebarView("explorer") },
      { id: "view-search", title: "検索 / 置換を表示", run: () => setSidebarView("search") },
      { id: "view-git", title: "ソース管理を表示", run: () => setSidebarView("git") },
      { id: "toggle-chat", title: "AI エージェントの表示切替", hint: "Ctrl+Alt+B", run: () => setChatOpen((v) => !v) },
      { id: "toggle-terminal", title: "ターミナルの表示切替", hint: "Ctrl+J", run: () => setTerminalOpen((v) => !v) },
      { id: "toggle-autosave", title: "自動保存の切替", run: () => setAutoSave((v) => !v) },
      {
        id: "toggle-theme",
        title: "テーマ切替（ライト / ダーク）",
        run: () => setTheme((t) => (t === "light" ? "dark" : "light")),
      },
      { id: "settings", title: "設定を開く", run: () => setSidebarView("settings") },
      { id: "check-update", title: "更新を確認", run: () => setUpdateCheckNonce((n) => n + 1) },
      {
        id: "git-blame",
        title: "Git: 現在のファイルの blame",
        run: () => {
          if (activeTab?.path) setBlamePath(activeTab.path);
        },
      },
      {
        id: "outline",
        title: "アウトライン / シンボル検索",
        hint: "Ctrl+Shift+O",
        run: () => {
          editorInstanceRef.current?.focus();
          editorInstanceRef.current?.getAction("editor.action.quickOutline")?.run();
        },
      },
      {
        id: "split-editor",
        title: "エディタの分割表示を切替",
        run: () => {
          setRightActiveId((r) => r ?? activeId);
          setSplitOn((v) => !v);
        },
      },
    ],
    [handleOpenFolder, handleOpen, handleSave, handleNewTab, openPalette, setChatOpen, setTerminalOpen, setAutoSave, setTheme, activeTab?.path, activeId],
  );

  // Configurable keyboard shortcuts (reloaded when settings change).
  const [keys, setKeys] = useState(() => loadKeybindings());
  useEffect(() => setKeys(loadKeybindings()), [settingsVersion]);

  useEffect(() => {
    const actions: Record<ActionId, () => void> = {
      save: () => handleSave(),
      palette: () => openPalette("command"),
      quickOpen: () => openPalette("file"),
      toggleSidebar: () => setSidebarView((cur) => (cur ? null : lastSidebarRef.current)),
      toggleChat: () => setChatOpen((v) => !v),
      toggleTerminal: () => setTerminalOpen((v) => !v),
      outline: () => {
        editorInstanceRef.current?.focus();
        editorInstanceRef.current?.getAction("editor.action.quickOutline")?.run();
      },
    };
    function onKey(e: KeyboardEvent) {
      const combo = comboFromEvent(e);
      if (!combo) return;
      const action = (Object.keys(keys) as ActionId[]).find((a) => keys[a] === combo);
      if (action) {
        e.preventDefault();
        actions[action]();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keys, handleSave, openPalette, setChatOpen, setTerminalOpen]);

  const onMouseDown = useCallback(() => {
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setEditorPct(Math.min(80, Math.max(25, pct)));
  }, []);

  const stopDrag = useCallback(() => {
    dragging.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  // Auto-save: write the active tab a short delay after the last edit.
  useEffect(() => {
    if (!autoSave || !activeTab?.path || !activeTab.dirty) return;
    const { path, content, id: tabId } = activeTab;
    const id = window.setTimeout(() => {
      writeFile(path, content)
        .then(() => updateTab(tabId, { dirty: false }))
        .catch(() => {});
    }, 800);
    return () => window.clearTimeout(id);
  }, [autoSave, activeTab?.path, activeTab?.content, activeTab?.dirty, activeTab?.id, updateTab]);

  // Open files dragged onto the window.
  const openPathRef = useRef(openPath);
  openPathRef.current = openPath;
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((e) => {
        if (e.payload.type === "drop") {
          for (const p of e.payload.paths) openPathRef.current(p);
        }
      })
      .then((u) => (unlisten = u))
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  return (
    <div className="flex h-screen flex-col bg-[#1e1e1e] text-neutral-200">
      <header className="flex items-center gap-2 border-b border-neutral-800 bg-[#323233] px-3 py-2">
        <svg width="22" height="22" viewBox="0 0 48 48" fill="none" aria-label="lokicode">
          <rect x="2" y="2" width="44" height="44" rx="11" fill="#171029" />
          <path d="M20 18 C16 13 12 10 7 8 C9 13 12 18 19 21 Z" fill="#39e25a" />
          <path d="M28 18 C32 13 36 10 41 8 C39 13 36 18 29 21 Z" fill="#39e25a" />
          <g stroke="#5df06f" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="19,26 13,32 19,38" />
            <polyline points="29,26 35,32 29,38" />
            <line x1="27" y1="25" x2="21" y2="39" />
          </g>
        </svg>
        <span className="text-sm font-semibold tracking-wide text-neutral-100">lokicode</span>
        <button
          onClick={() => setChatOpen((v) => !v)}
          title={chatOpen ? "AI エージェントを隠す" : "AI エージェントを表示"}
          className={
            "ml-auto rounded p-1 hover:bg-neutral-700 " +
            (chatOpen ? "text-blue-400" : "text-neutral-400 hover:text-neutral-200")
          }
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M15 4v16" />
          </svg>
        </button>
      </header>

      <UpdateBanner manualNonce={updateCheckNonce} />

      <div className="flex min-h-0 flex-1">
        <ActivityBar view={sidebarView} onSelect={handleActivitySelect} />

        {/* One persistent sidebar: every pane stays mounted and is toggled by
            visibility, so switching views never remounts/refetches (fast). */}
        <aside
          className={
            "shrink-0 border-r border-neutral-800 " +
            (sidebarView === "settings"
              ? "w-72"
              : sidebarView
                ? "w-60"
                : "w-0 overflow-hidden border-r-0")
          }
        >
          <div className={sidebarView === "settings" ? "h-full" : "hidden"}>
            <SettingsPane
              onSaved={() => setSettingsVersion((v) => v + 1)}
              theme={theme === "light" ? "light" : "dark"}
              onThemeChange={setTheme}
            />
          </div>

          {workspaceRoot ? (
            <>
              <div className={sidebarView === "explorer" ? "h-full" : "hidden"}>
                <ExplorerPane
                  roots={workspaceRoots}
                  activePath={activeTab?.path ?? null}
                  onOpenFile={openPath}
                  onOpenFolder={handleOpenFolder}
                  onAddFolder={handleAddFolder}
                  onRemoveRoot={removeRoot}
                  onClose={() => setSidebarView(null)}
                  reloadKey={fsNonce}
                />
              </div>
              <div className={sidebarView === "search" ? "h-full" : "hidden"}>
                <SearchPane root={workspaceRoot} onOpenFile={openPath} />
              </div>
              <div className={sidebarView === "git" ? "h-full" : "hidden"}>
                <SourceControlPane
                  root={workspaceRoot}
                  active={sidebarView === "git"}
                  onOpenDiff={setDiffTarget}
                  reloadKey={fsNonce}
                />
              </div>
            </>
          ) : (
            <div
              className={
                sidebarView && sidebarView !== "settings" ? "h-full" : "hidden"
              }
            >
              <div className="flex h-full flex-col items-stretch gap-3 bg-[#1b1b1c] p-3 text-xs text-neutral-400">
                <p>フォルダを開くと、ここにファイルや Git の状態が表示されます。</p>
                <button
                  onClick={handleOpenFolder}
                  className="self-start rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-500"
                >
                  フォルダを開く
                </button>
                {recentFolders().length > 0 && (
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                      最近開いたフォルダ
                    </div>
                    {recentFolders().map((p) => (
                      <button
                        key={p}
                        onClick={() => openFolderPath(p)}
                        title={p}
                        className="block w-full truncate rounded px-2 py-1 text-left text-neutral-300 hover:bg-neutral-800"
                      >
                        {fileNameFromPath(p) || p}
                        <span className="ml-1 text-neutral-600">{p}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          ref={containerRef}
          className="flex min-h-0 min-w-0 flex-1"
          onMouseMove={onMouseMove}
          onMouseUp={stopDrag}
          onMouseLeave={stopDrag}
        >
          <div style={{ width: chatOpen ? `${editorPct}%` : "100%" }} className="min-w-0">
            {blamePath ? (
              <BlameView
                cwd={workspaceRoot ?? blamePath.replace(/[\\/][^\\/]+$/, "")}
                path={blamePath}
                onClose={() => setBlamePath(null)}
              />
            ) : diffTarget && workspaceRoot ? (
              <GitDiffView
                root={workspaceRoot}
                target={diffTarget}
                onOpenFile={(path) => {
                  setDiffTarget(null);
                  openPath(path);
                }}
                onClose={() => setDiffTarget(null)}
              />
            ) : !activeTab ? (
              <div className="flex h-full flex-col items-center justify-center gap-5 bg-[#1e1e1e] text-neutral-500">
                <div className="text-6xl opacity-25">📄</div>
                <p className="text-sm">開いているファイルはありません</p>
                <div className="flex gap-2 text-xs">
                  <button
                    onClick={handleNewTab}
                    className="rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-500"
                  >
                    新規ファイル
                  </button>
                  <button
                    onClick={handleOpen}
                    className="rounded border border-neutral-700 px-3 py-1.5 text-neutral-200 hover:bg-neutral-800"
                  >
                    ファイルを開く
                  </button>
                  <button
                    onClick={handleOpenFolder}
                    className="rounded border border-neutral-700 px-3 py-1.5 text-neutral-200 hover:bg-neutral-800"
                  >
                    フォルダを開く
                  </button>
                </div>
              </div>
            ) : splitOn ? (
              <div className="flex h-full">
                <div className="min-w-0 flex-1">
                  <EditorPane
                    tabs={tabs}
                    activeTab={activeTab}
                    onSelectTab={setActiveId}
                    onCloseTab={handleCloseTab}
                    onNewTab={handleNewTab}
                    onChange={handleChange}
                    onQuickAction={handleQuickAction}
                    onReorderTab={reorderTabs}
                    onTogglePin={togglePinTab}
                    onEditorReady={(ed) => (editorInstanceRef.current = ed)}
                    theme={theme === "light" ? "light" : "dark"}
                  />
                </div>
                <div className="w-px shrink-0 bg-neutral-800" />
                <div className="min-w-0 flex-1">
                  <EditorPane
                    tabs={tabs}
                    activeTab={rightTab ?? activeTab}
                    onSelectTab={setRightActiveId}
                    onCloseTab={handleCloseTab}
                    onNewTab={handleNewTab}
                    onChange={(v) => updateTab((rightTab ?? activeTab).id, { content: v, dirty: true })}
                    onQuickAction={handleQuickAction}
                    onReorderTab={reorderTabs}
                    onTogglePin={togglePinTab}
                    onEditorReady={() => {}}
                    theme={theme === "light" ? "light" : "dark"}
                  />
                </div>
              </div>
            ) : (
              <EditorPane
                tabs={tabs}
                activeTab={activeTab}
                onSelectTab={setActiveId}
                onCloseTab={handleCloseTab}
                onNewTab={handleNewTab}
                onChange={handleChange}
                onQuickAction={handleQuickAction}
                onReorderTab={reorderTabs}
                onTogglePin={togglePinTab}
                onEditorReady={(ed) => (editorInstanceRef.current = ed)}
                theme={theme === "light" ? "light" : "dark"}
              />
            )}
          </div>

          {chatOpen && (
            <div
              onMouseDown={onMouseDown}
              className="w-1 cursor-col-resize bg-neutral-800 transition-colors hover:bg-blue-500"
            />
          )}

          {/* Kept mounted (hidden when collapsed) so chat state and "選択をAIへ" survive toggling.
              A floor width keeps it from collapsing to invisible, and its own ErrorBoundary
              means a chat-only crash shows an in-pane reset instead of vanishing. */}
          <div
            style={chatOpen ? { width: `${100 - editorPct}%` } : undefined}
            className={chatOpen ? "min-w-[320px]" : "hidden"}
          >
            <ErrorBoundary compact>
              <ChatPane
                ref={chatRef}
                onOpenSettings={() => setSidebarView("settings")}
                settingsVersion={settingsVersion}
                currentCode={activeTab?.content ?? ""}
                currentFileName={activeTab?.name ?? "untitled"}
                currentFilePath={activeTab?.path ?? null}
                workspaceRoot={workspaceRoot}
                onFilesChanged={() => setFsNonce((n) => n + 1)}
              />
            </ErrorBoundary>
          </div>
        </div>

          {terminalOpen && (
            <div className="h-56 shrink-0">
              <TerminalPanel cwd={workspaceRoot} onClose={() => setTerminalOpen(false)} />
            </div>
          )}
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        mode={paletteMode}
        commands={commands}
        files={paletteFiles}
        onClose={() => setPaletteOpen(false)}
        onSelectFile={(rel) => workspaceRoot && openPath(joinPath(workspaceRoot, rel))}
      />
    </div>
  );
}
