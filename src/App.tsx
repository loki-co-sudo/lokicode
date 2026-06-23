import { useCallback, useEffect, useRef, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { usePersistentBool, usePersistentString } from "./lib/usePersistentState";
import EditorPane from "./components/EditorPane";
import ChatPane, { type ChatPaneHandle } from "./components/ChatPane";
import SettingsModal from "./components/SettingsModal";
import ExplorerPane from "./components/ExplorerPane";
import SourceControlPane from "./components/SourceControlPane";
import GitDiffView, { type DiffTarget } from "./components/GitDiffView";
import UpdateBanner from "./components/UpdateBanner";
import ActivityBar, { type SidebarView } from "./components/ActivityBar";
import {
  openFile,
  openFolder,
  readFile,
  writeFile,
  saveFileAs,
  fileNameFromPath,
  languageFromPath,
} from "./lib/files";

export interface Tab {
  id: string;
  name: string;
  path: string | null;
  language: string;
  content: string;
  dirty: boolean;
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
    return s === "explorer" || s === "git" ? s : null;
  });
  useEffect(() => {
    if (sidebarView) localStorage.setItem("lokicode.sidebarView", sidebarView);
    else localStorage.removeItem("lokicode.sidebarView");
  }, [sidebarView]);

  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  const [updateCheckNonce, setUpdateCheckNonce] = useState(0);
  // Whether the right-hand AI Agent pane is shown (collapsible like the sidebar).
  const [chatOpen, setChatOpen] = usePersistentBool("lokicode.chatOpen", true);

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
    },
    [tabs],
  );

  const handleOpenFolder = useCallback(async () => {
    const dir = await openFolder();
    if (!dir) return;
    setWorkspaceRoot(dir);
    setSidebarView("explorer");
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

  const handleSendSelection = useCallback(
    (code: string, language: string) => {
      setChatOpen(true); // reveal the pane if it was collapsed
      const fence = language && language !== "plaintext" ? language : "";
      chatRef.current?.prefill(`以下のコードについて教えてください:\n\n\`\`\`${fence}\n${code}\n\`\`\``);
    },
    [setChatOpen],
  );

  // Ctrl/Cmd+S to save the active tab.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSave();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave]);

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
              <div className="flex h-full flex-col items-start gap-3 bg-[#1b1b1c] p-3 text-xs text-neutral-400">
                <p>フォルダを開くと、ここにファイルや Git の状態が表示されます。</p>
                <button
                  onClick={handleOpenFolder}
                  className="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-500"
                >
                  フォルダを開く
                </button>
              </div>
            </aside>
          )
        )}

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
                onOpen={handleOpen}
                onSave={handleSave}
                onSendSelection={handleSendSelection}
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
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => setSettingsVersion((v) => v + 1)}
      />
    </div>
  );
}
