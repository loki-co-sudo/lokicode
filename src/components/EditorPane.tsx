import Editor from "@monaco-editor/react";
import type { Tab } from "../App";

interface EditorPaneProps {
  tabs: Tab[];
  activeTab: Tab;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onChange: (value: string) => void;
  theme: "dark" | "light";
}

export default function EditorPane({
  tabs,
  activeTab,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onChange,
  theme,
}: EditorPaneProps) {
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
                onClick={() => onSelectTab(tab.id)}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    // middle-click closes the tab
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
                <span className="whitespace-nowrap">{tab.name}</span>
                <span className="flex h-4 w-4 items-center justify-center">
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
