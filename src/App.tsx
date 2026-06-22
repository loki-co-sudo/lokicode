import { useCallback, useRef, useState } from "react";
import EditorPane from "./components/EditorPane";
import ChatPane from "./components/ChatPane";

const SAMPLE_CODE = `// index.js — sample file
function greet(name) {
  return \`Hello, \${name}!\`;
}

const target = "world";
console.log(greet(target));
`;

export default function App() {
  const [code, setCode] = useState(SAMPLE_CODE);
  // Width of the editor pane as a percentage of the workspace.
  const [editorPct, setEditorPct] = useState(62);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onMouseDown = useCallback(() => {
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    // Clamp so neither pane collapses entirely.
    setEditorPct(Math.min(80, Math.max(25, pct)));
  }, []);

  const stopDrag = useCallback(() => {
    dragging.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  return (
    <div className="flex h-screen flex-col bg-[#1e1e1e] text-neutral-200">
      {/* Top bar */}
      <header className="flex items-center gap-2 border-b border-neutral-800 bg-[#323233] px-4 py-2">
        <span className="text-sm font-semibold tracking-wide text-neutral-100">
          lokicode
        </span>
        <span className="text-xs text-neutral-500">
          — VS Code-style editor with AI chat
        </span>
      </header>

      {/* Workspace: editor | divider | chat */}
      <div
        ref={containerRef}
        className="flex min-h-0 flex-1"
        onMouseMove={onMouseMove}
        onMouseUp={stopDrag}
        onMouseLeave={stopDrag}
      >
        <div style={{ width: `${editorPct}%` }} className="min-w-0">
          <EditorPane
            fileName="index.js"
            language="javascript"
            value={code}
            onChange={setCode}
          />
        </div>

        {/* Draggable divider */}
        <div
          onMouseDown={onMouseDown}
          className="w-1 cursor-col-resize bg-neutral-800 transition-colors hover:bg-blue-500"
        />

        <div style={{ width: `${100 - editorPct}%` }} className="min-w-0">
          <ChatPane />
        </div>
      </div>
    </div>
  );
}
