import Editor from "@monaco-editor/react";

interface EditorPaneProps {
  fileName: string;
  language: string;
  value: string;
  dirty: boolean;
  onChange: (value: string) => void;
  onOpen: () => void;
  onSave: () => void;
}

export default function EditorPane({
  fileName,
  language,
  value,
  dirty,
  onChange,
  onOpen,
  onSave,
}: EditorPaneProps) {
  return (
    <div className="flex h-full flex-col bg-[#1e1e1e]">
      {/* Tab / toolbar bar */}
      <div className="flex items-center justify-between border-b border-neutral-800 bg-[#252526] px-4 py-2 text-sm text-neutral-300">
        <span className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          {fileName}
          {dirty && <span className="text-neutral-500" title="未保存の変更">●</span>}
        </span>
        <span className="flex items-center gap-1">
          <button
            onClick={onOpen}
            className="rounded px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
            title="ファイルを開く"
          >
            開く
          </button>
          <button
            onClick={onSave}
            className="rounded px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
            title="保存 (Ctrl+S)"
          >
            保存
          </button>
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          theme="vs-dark"
          path={fileName}
          language={language}
          value={value}
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
