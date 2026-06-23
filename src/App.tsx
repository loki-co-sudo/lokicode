import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { usePersistentBool, usePersistentString } from "./lib/usePersistentState";
import EditorPane from "./components/EditorPane";
import ChatPane, { type ChatPaneHandle } from "./components/ChatPane";
import SettingsModal from "./components/SettingsModal";
import ExplorerPane from "./components/ExplorerPane";
import SourceControlPane from "./components/SourceControlPane";
import GitDiffView, { type DiffTarget } from "./components/GitDiffView";
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

export interface Tab {
  id: string;
  name: string;
  path: string | null;
  language: string;
  content: string;
  dirty: boolean;
  pinned?: boolean;
}

const SAMPLE_CODE = `// index.js — sample file
function greet(name) {
  return \`Hello, \${name}!\`;
}

const target = "world";
console.log(greet(target));
`;

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
  const [tabs, setTabs] = useState<Tab[]>(() => [
    createTab({ name: "index.js", language: "javascript", content: SAMPLE_CODE }),
  ]);
  const [activeId, setActiveId] = useState(() => tabs[0].id);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsVersion, setSettingsVersion] = useState(0);

  // Remember the open workspace folder and which sidebar panel was shown,
  // so they are restored on the next launch.
  const [workspaceRoot, setWorkspaceRoot] = usePersistentString("lokicode.workspaceRoot", null);
  const [sidebarView, setSidebarView] = useState<SidebarView>(() => {
    const s = localStorage.getItem("lokicode.sidebarView");
    return s === "explorer" || s === "search" || s === "git" ? s : null;
  });
  useEffect(() => {
    if (sidebarView) localStorage.setItem("lokicode.sidebarView", sidebarView);
    else localStorage.removeItem("lokicode.sidebarView");
  }, [sidebarView]);

  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  const [updateCheckNonce, setUpdateCheckNonce] = useState(0);
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

  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];

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

  const openFolderPath = useCallback(
    (dir: string) => {
      setWorkspaceRoot(dir);
      setSidebarView("explorer");
      addRecentFolder(dir);
    },
    [setWorkspaceRoot],
  );

  const handleOpenFolder = useCallback(async () => {
    const dir = await openFolder();
    if (dir) openFolderPath(dir);
  }, [openFolderPath]);

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
        const next = remaining.length > 0 ? remaining : [createTab({ name: "untitled" })];
        if (id === activeId) {
          const idx = prev.findIndex((t) => t.id === id);
          const neighbor = next[Math.min(idx, next.length - 1)];
          setActiveId(neighbor.id);
        }
        return next;
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
      { id: "settings", title: "設定を開く", run: () => setSettingsOpen(true) },
      { id: "check-update", title: "更新を確認", run: () => setUpdateCheckNonce((n) => n + 1) },
    ],
    [handleOpenFolder, handleOpen, handleSave, handleNewTab, openPalette, setChatOpen, setTerminalOpen, setAutoSave, setTheme],
  );

  // Global shortcuts: save, palette/quick-open, and panel toggles.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && e.altKey && key === "b") {
        e.preventDefault();
        setChatOpen((v) => !v); // Ctrl+Alt+B: AI エージェントパネル
      } else if (mod && key === "b") {
        e.preventDefault();
        setSidebarView((cur) => (cur ? null : lastSidebarRef.current)); // Ctrl+B: サイドバー
      } else if (mod && key === "j") {
        e.preventDefault();
        setTerminalOpen((v) => !v); // Ctrl+J: ターミナル
      } else if (mod && e.shiftKey && key === "p") {
        e.preventDefault();
        openPalette("command");
      } else if (mod && key === "p") {
        e.preventDefault();
        openPalette("file");
      } else if (mod && key === "s") {
        e.preventDefault();
        handleSave();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave, openPalette, setChatOpen, setTerminalOpen]);

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
    if (!autoSave || !activeTab.path || !activeTab.dirty) return;
    const id = window.setTimeout(() => {
      writeFile(activeTab.path!, activeTab.content)
        .then(() => updateTab(activeTab.id, { dirty: false }))
        .catch(() => {});
    }, 800);
    return () => window.clearTimeout(id);
  }, [autoSave, activeTab.path, activeTab.content, activeTab.dirty, activeTab.id, updateTab]);

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
        <span className="text-sm font-semibold tracking-wide text-neutral-100">lokicode</span>
        <span className="text-xs text-neutral-500">— VS Code-style editor with AI agent</span>
        <button
          onClick={() => setUpdateCheckNonce((n) => n + 1)}
          className="ml-auto rounded px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
          title="更新を確認"
        >
          更新を確認
        </button>
        <button
          onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          title="テーマ切替（ライト / ダーク）"
          className="rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
        >
          {theme === "light" ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
            </svg>
          )}
        </button>
        <button
          onClick={() => setChatOpen((v) => !v)}
          title={chatOpen ? "AI エージェントを隠す" : "AI エージェントを表示"}
          className={
            "rounded p-1 hover:bg-neutral-700 " +
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

        {workspaceRoot ? (
          // Keep both panes mounted so their data survives view switches
          // (no reload flicker); collapse to width 0 when the sidebar is hidden.
          <aside
            className={
              "shrink-0 border-r border-neutral-800 " +
              (sidebarView ? "w-60" : "w-0 overflow-hidden border-r-0")
            }
          >
            <div className={sidebarView === "explorer" ? "h-full" : "hidden"}>
              <ExplorerPane
                root={workspaceRoot}
                activePath={activeTab.path}
                onOpenFile={openPath}
                onOpenFolder={handleOpenFolder}
                onClose={() => setSidebarView(null)}
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
              />
            </div>
          </aside>
        ) : (
          sidebarView && (
            <aside className="w-60 shrink-0 border-r border-neutral-800">
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
            </aside>
          )
        )}

        <div className="flex min-h-0 flex-1 flex-col">
        <div
          ref={containerRef}
          className="flex min-h-0 flex-1"
          onMouseMove={onMouseMove}
          onMouseUp={stopDrag}
          onMouseLeave={stopDrag}
        >
          <div style={{ width: chatOpen ? `${editorPct}%` : "100%" }} className="min-w-0">
            {diffTarget && workspaceRoot ? (
              <GitDiffView
                root={workspaceRoot}
                target={diffTarget}
                onOpenFile={(path) => {
                  setDiffTarget(null);
                  openPath(path);
                }}
                onClose={() => setDiffTarget(null)}
              />
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

          {/* Kept mounted (hidden when collapsed) so chat state and "選択をAIへ" survive toggling. */}
          <div
            style={chatOpen ? { width: `${100 - editorPct}%` } : undefined}
            className={chatOpen ? "min-w-0" : "hidden"}
          >
            <ChatPane
              ref={chatRef}
              onOpenSettings={() => setSettingsOpen(true)}
              settingsVersion={settingsVersion}
              currentCode={activeTab.content}
              currentFileName={activeTab.name}
              currentFilePath={activeTab.path}
              workspaceRoot={workspaceRoot}
            />
          </div>
        </div>

          {terminalOpen && (
            <div className="h-56 shrink-0">
              <TerminalPanel cwd={workspaceRoot} onClose={() => setTerminalOpen(false)} />
            </div>
          )}
        </div>
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => setSettingsVersion((v) => v + 1)}
      />

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
