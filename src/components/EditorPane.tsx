import { useRef } from "react";
import Editor from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import type { Tab } from "../App";

interface EditorPaneProps {
  tabs: Tab[];
  activeTab: Tab;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onChange: (value: string) => void;
  onOpen: () => void;
  onSave: () => void;
  onSendSelection: (code: string, language: string) => void;
}

export default function EditorPane({
  tabs,
  activeTab,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onChange,
  onOpen,
  onSave,
  onSendSelection,
}: EditorPaneProps) {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);

  function handleSendSelection() {
    const editor = editorRef.current;
    if (!editor) return;
    const selection = editor.getSelection();
    const model = editor.getModel();
    if (!model) return;
    const selected =
      selection && !selection.isEmpty() ? model.getValueInRange(selection) : model.getValue();
    if (selected.trim()) onSendSelection(selected, activeTab.language);
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
                onClick={() => onSelectTab(tab.id)}
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
        {/* Toolbar */}
        <div className="flex items-center gap-1 border-l border-neutral-800 px-2">
          <button onClick={onOpen} title="ファイルを開く" className="rounded px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700">
            開く
          </button>
          <button onClick={onSave} title="保存 (Ctrl+S)" className="rounded px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700">
            保存
          </button>
          <button onClick={handleSendSelection} title="選択範囲（なければ全体）を AI チャットへ" className="rounded px-2 py-1 text-xs text-blue-300 hover:bg-neutral-700">
            選択をAIへ
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          theme="vs-dark"
          path={activeTab.id}
          language={activeTab.language}
          value={activeTab.content}
          onMount={(editor) => {
            editorRef.current = editor;
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
