import { useEffect, useState } from "react";
import { diffLines } from "diff";
import { invoke } from "@tauri-apps/api/core";

/** Shows a line diff between the existing file (if any) and the proposed content. */
export default function DiffPreview({ path, newContent }: { path: string; newContent: string }) {
  const [oldContent, setOldContent] = useState<string | null>(null);
  const [exists, setExists] = useState(true);

  useEffect(() => {
    let cancelled = false;
    invoke<string>("read_text_file", { path })
      .then((c) => {
        if (cancelled) return;
        setOldContent(c);
        setExists(true);
      })
      .catch(() => {
        if (cancelled) return;
        setOldContent("");
        setExists(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (oldContent === null) {
    return <div className="text-neutral-500">差分を読み込み中…</div>;
  }

  const parts = diffLines(oldContent, newContent);
  let added = 0;
  let removed = 0;
  for (const p of parts) {
    const lines = p.value.replace(/\n$/, "").split("\n").length;
    if (p.added) added += lines;
    else if (p.removed) removed += lines;
  }

  return (
    <div>
      <div className="mb-1 flex gap-3 text-[11px]">
        <span className="font-mono text-neutral-400">{path}</span>
        {!exists && <span className="text-emerald-400">新規ファイル</span>}
        <span className="text-emerald-400">+{added}</span>
        <span className="text-red-400">-{removed}</span>
      </div>
      <div className="max-h-60 overflow-auto rounded bg-black/30 p-2 font-mono text-[11px] leading-relaxed">
        {parts.map((p, i) =>
          p.value
            .replace(/\n$/, "")
            .split("\n")
            .map((line, j) => {
              const cls = p.added
                ? "bg-emerald-900/30 text-emerald-300"
                : p.removed
                  ? "bg-red-900/30 text-red-300"
                  : "text-neutral-500";
              const prefix = p.added ? "+" : p.removed ? "-" : " ";
              return (
                <div key={`${i}-${j}`} className={"whitespace-pre-wrap " + cls}>
                  {prefix} {line}
                </div>
              );
            }),
        )}
      </div>
    </div>
  );
}
