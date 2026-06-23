import { useRef } from "react";
import Editor from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import type { Tab } from "../App";

export type QuickAction = "explain" | "refactor" | "test";

interface EditorPaneProps {
  tabs: Tab[];
  activeTab: Tab;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onChange: (value: string) => void;
  onQuickAction: (action: QuickAction, code: string, language: string) => void;
  onReorderTab: (fromId: string, toId: string) => void;
  onTogglePin: (id: string) => void;
  theme: "dark" | "light";
}

export default function EditorPane({
  tabs,
  activeTab,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onChange,
  onQuickAction,
  onReorderTab,
  onTogglePin,
  theme,
}: EditorPaneProps) {
  const dragIdRef = useRef<string | null>(null);
  // Refs so the (once-registered) editor actions always see the latest props.
  const qaRef = useRef(onQuickAction);
  qaRef.current = onQuickAction;
  const langRef = useRef(activeTab.language);
  langRef.current = activeTab.language;

  function runQuick(action: QuickAction, ed: MonacoEditor.ICodeEditor) {
    const model = ed.getModel();
    if (!model) return;
    const sel = ed.getSelection();
    const code = sel && !sel.isEmpty() ? model.getValueInRange(sel) : model.getValue();
    if (code.trim()) qaRef.current(action, code, langRef.current);
  }

  return (
    <div className="flex h-full flex-col bg-[#1e1e1e]">
      {/* Tabs bar */}
      <div className="flex items-stretch border-b border-neutral-800 bg-[#252526] text-sm">
        <div className="flex min-w-0 flex-1 overflow-x-auto">
          {tabs.map((tab) => {
            const active = tab.id === activeTab.id;
            return (
              <div
                key={tab.id}
                draggable
                onDragStart={() => (dragIdRef.current = tab.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIdRef.current) onReorderTab(dragIdRef.current, tab.id);
                  dragIdRef.current = null;
                }}
                onClick={() => onSelectTab(tab.id)}
                onMouseDown={(e) => {
                  if (e.button === 1 && !tab.pinned) {
                    // middle-click closes the tab (pinned tabs are protected)
                    e.preventDefault();
                    onCloseTab(tab.id);
                  }
                }}
                className={
                  "group flex cursor-pointer items-center gap-2 border-r border-neutral-800 px-3 py-2 " +
                  (active ? "bg-[#1e1e1e] text-neutral-100" : "text-neutral-400 hover:bg-neutral-800")
                }
                title={tab.path ?? tab.name}
              >
                <span className="whitespace-nowrap">
                  {tab.pinned && <span className="mr-1 text-blue-400">📌</span>}
                  {tab.name}
                </span>
                <span className="flex h-4 items-center justify-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onTogglePin(tab.id);
                    }}
                    title={tab.pinned ? "ピン留めを解除" : "ピン留め"}
                    className={
                      "rounded text-[10px] text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200 " +
                      (tab.pinned ? "hidden" : "opacity-0 group-hover:opacity-100")
                    }
                  >
                    📌
                  </button>
                  {tab.dirty ? (
                    <span className="text-neutral-400 group-hover:hidden">●</span>
                  ) : null}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(tab.id);
                    }}
                    title="閉じる"
                    className={
                      "rounded text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200 " +
                      (tab.dirty ? "hidden group-hover:block" : "")
                    }
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </span>
              </div>
            );
          })}
          <button
            onClick={onNewTab}
            title="新しいファイル"
            className="px-3 py-2 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            +
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          theme={theme === "light" ? "vs" : "vs-dark"}
          path={activeTab.id}
          language={activeTab.language}
          value={activeTab.content}
          onMount={(ed) => {
            const items: { id: string; label: string; action: QuickAction; order: number }[] = [
              { id: "loki.explain", label: "lokicode: 選択範囲を説明", action: "explain", order: 1.5 },
              { id: "loki.refactor", label: "lokicode: リファクタリング", action: "refactor", order: 1.6 },
              { id: "loki.test", label: "lokicode: テストを生成", action: "test", order: 1.7 },
            ];
            for (const it of items) {
              ed.addAction({
                id: it.id,
                label: it.label,
                contextMenuGroupId: "navigation",
                contextMenuOrder: it.order,
                run: (e) => runQuick(it.action, e),
              });
            }
          }}
          onChange={(v) => onChange(v ?? "")}
          options={{
            fontSize: 14,
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
          }}
        />
      </div>
    </div>
  );
}
