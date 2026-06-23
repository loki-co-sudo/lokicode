import { useEffect, useMemo, useRef, useState } from "react";
import { useModels } from "../lib/useModels";

interface ModelPickerProps {
  value: string;
  onChange: (id: string) => void;
  /** unique id (kept for compatibility; also used for testability) */
  listId: string;
  className?: string;
  /** Which edge the dropdown aligns to (use "right" for right-side pickers). */
  align?: "left" | "right";
  /** Open the dropdown upward (use "up" when the picker sits near the bottom). */
  placement?: "down" | "up";
}

/** Provider key = the part before "/" in an OpenRouter model id (e.g. "anthropic"). */
function providerOf(id: string): string {
  const i = id.indexOf("/");
  return i === -1 ? id : id.slice(0, i);
}

/** Cost tier from the output price (per 1M tokens). */
function costTier(completionPrice: number, promptPrice: number): { label: string; cls: string } {
  if (completionPrice <= 0 && promptPrice <= 0) return { label: "無料", cls: "text-sky-400" };
  const perM = completionPrice * 1_000_000;
  if (perM < 1) return { label: "低", cls: "text-emerald-400" };
  if (perM < 10) return { label: "中", cls: "text-amber-400" };
  return { label: "高", cls: "text-red-400" };
}

function fmtPerM(price: number): string {
  const v = price * 1_000_000;
  if (v <= 0) return "—";
  return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}`;
}

function fmtCtx(n: number): string {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

/**
 * Searchable model picker backed by the auto-updating OpenRouter list.
 * Supports free-text search and per-provider (Claude / GPT / …) filtering.
 */
export default function ModelPicker({
  value,
  onChange,
  className,
  align = "left",
  placement = "down",
}: ModelPickerProps) {
  const { models, loading, refresh } = useModels();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [providers, setProviders] = useState<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  // Distinct providers with counts, most common first.
  const providerList = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of models) counts.set(providerOf(m.id), (counts.get(providerOf(m.id)) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [models]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter((m) => {
      if (providers.size > 0 && !providers.has(providerOf(m.id))) return false;
      if (!q) return true;
      return m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
    });
  }, [models, query, providers]);

  function toggleProvider(p: string) {
    setProviders((prev) => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
  }

  function select(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={rootRef} className={"relative flex items-center gap-1 " + (className ?? "")}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={value}
        className="min-w-0 flex-1 truncate rounded-md border border-neutral-700 bg-[#1e1e1e] px-2 py-1 text-left text-xs text-neutral-100 outline-none hover:border-neutral-600 focus:border-blue-500"
      >
        {value || "モデルを選択…"}
        <span className="float-right text-neutral-500">▾</span>
      </button>
      <button
        onClick={refresh}
        title="モデル一覧を更新"
        className="rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
      >
        {loading ? "…" : "⟳"}
      </button>

      {open && (
        <div
          className={
            "absolute z-50 flex max-h-[26rem] w-[22rem] max-w-[min(90vw,22rem)] flex-col overflow-hidden rounded-md border border-neutral-700 bg-[#252526] shadow-xl " +
            (placement === "up" ? "bottom-full mb-1 " : "top-full mt-1 ") +
            (align === "right" ? "right-0" : "left-0")
          }
        >
          <div className="border-b border-neutral-800 p-2">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="モデルを検索…（例: gpt, gemini, free）"
              spellCheck={false}
              className="w-full rounded border border-neutral-700 bg-[#1e1e1e] px-2 py-1 text-xs text-neutral-100 outline-none focus:border-blue-500"
            />
            {providerList.length > 0 && (
              <div className="mt-2 flex max-h-[4.5rem] flex-wrap gap-1 overflow-y-auto pr-1">
                {providerList.map(([p, n]) => {
                  const on = providers.has(p);
                  return (
                    <button
                      key={p}
                      onClick={() => toggleProvider(p)}
                      title={`${n} モデル`}
                      className={
                        "rounded-full border px-2 py-0.5 text-[10px] " +
                        (on
                          ? "border-blue-500 bg-blue-600/30 text-blue-200"
                          : "border-neutral-700 text-neutral-400 hover:border-neutral-600")
                      }
                    >
                      {p} {n}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto py-1">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-neutral-600">
                {loading ? "読み込み中…" : "該当するモデルがありません"}
              </div>
            )}
            {filtered.map((m) => (
              <button
                key={m.id}
                onClick={() => select(m.id)}
                className={
                  "block w-full px-3 py-1 text-left hover:bg-neutral-700 " +
                  (m.id === value ? "bg-blue-600/20" : "")
                }
              >
                <div className="truncate text-xs text-neutral-100">{m.name}</div>
                <div className="truncate text-[10px] text-neutral-500">{m.id}</div>
                <div className="flex gap-2 text-[10px] text-neutral-500">
                  <span>
                    コスト <span className={costTier(m.completionPrice, m.promptPrice).cls}>{costTier(m.completionPrice, m.promptPrice).label}</span>
                  </span>
                  <span>出力 {fmtPerM(m.completionPrice)}/M</span>
                  {m.contextLength > 0 && <span>ctx {fmtCtx(m.contextLength)}</span>}
                </div>
              </button>
            ))}
          </div>

          <div className="border-t border-neutral-800 px-2 py-1 text-[10px] text-neutral-600">
            {filtered.length} / {models.length} モデル
          </div>
        </div>
      )}
    </div>
  );
}
