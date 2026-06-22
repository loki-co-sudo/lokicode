import Editor from "@monaco-editor/react";

interface EditorPaneProps {
  fileName: string;
  language: string;
  value: string;
  onChange: (value: string) => void;
}

export default function EditorPane({
  fileName,
  language,
  value,
  onChange,
}: EditorPaneProps) {
  return (
    <div className="flex h-full flex-col bg-[#1e1e1e]">
      {/* Tab / file name bar */}
      <div className="flex items-center gap-2 border-b border-neutral-800 bg-[#252526] px-4 py-2 text-sm text-neutral-300">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
        {fileName}
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          theme="vs-dark"
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
