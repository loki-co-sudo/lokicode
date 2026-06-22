import { useCallback, useEffect, useRef, useState } from "react";
import EditorPane from "./components/EditorPane";
import ChatPane from "./components/ChatPane";
import SettingsModal from "./components/SettingsModal";
import {
  openFile,
  writeFile,
  saveFileAs,
  fileNameFromPath,
  languageFromPath,
} from "./lib/files";

const SAMPLE_CODE = `// index.js — sample file
function greet(name) {
  return \`Hello, \${name}!\`;
}

const target = "world";
console.log(greet(target));
`;

export default function App() {
  const [code, setCode] = useState(SAMPLE_CODE);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState("index.js");
  const [language, setLanguage] = useState("javascript");
  const [dirty, setDirty] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsVersion, setSettingsVersion] = useState(0);

  const [editorPct, setEditorPct] = useState(62);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const handleChange = useCallback((value: string) => {
    setCode(value);
    setDirty(true);
  }, []);

  const handleOpen = useCallback(async () => {
    const file = await openFile();
    if (!file) return;
    setCode(file.content);
    setFilePath(file.path);
    setFileName(fileNameFromPath(file.path));
    setLanguage(languageFromPath(file.path));
    setDirty(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (filePath) {
      await writeFile(filePath, code);
      setDirty(false);
    } else {
      const path = await saveFileAs(code, fileName);
      if (!path) return;
      setFilePath(path);
      setFileName(fileNameFromPath(path));
      setLanguage(languageFromPath(path));
      setDirty(false);
    }
  }, [filePath, code, fileName]);

  // Ctrl/Cmd+S to save.
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
      <header className="flex items-center gap-2 border-b border-neutral-800 bg-[#323233] px-4 py-2">
        <span className="text-sm font-semibold tracking-wide text-neutral-100">lokicode</span>
        <span className="text-xs text-neutral-500">— VS Code-style editor with AI chat</span>
      </header>

      <div
        ref={containerRef}
        className="flex min-h-0 flex-1"
        onMouseMove={onMouseMove}
        onMouseUp={stopDrag}
        onMouseLeave={stopDrag}
      >
        <div style={{ width: `${editorPct}%` }} className="min-w-0">
          <EditorPane
            fileName={fileName}
            language={language}
            value={code}
            dirty={dirty}
            onChange={handleChange}
            onOpen={handleOpen}
            onSave={handleSave}
          />
        </div>

        <div
          onMouseDown={onMouseDown}
          className="w-1 cursor-col-resize bg-neutral-800 transition-colors hover:bg-blue-500"
        />

        <div style={{ width: `${100 - editorPct}%` }} className="min-w-0">
          <ChatPane
            onOpenSettings={() => setSettingsOpen(true)}
            settingsVersion={settingsVersion}
            currentCode={code}
            currentFileName={fileName}
          />
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
