import { useModels } from "../lib/useModels";

interface ModelPickerProps {
  value: string;
  onChange: (id: string) => void;
  /** unique id so multiple pickers don't share a <datalist> */
  listId: string;
  className?: string;
}

/**
 * Combobox backed by the auto-updating OpenRouter model list. The list is fetched
 * dynamically (no hardcoded models); free text is still allowed for any model id.
 */
export default function ModelPicker({ value, onChange, listId, className }: ModelPickerProps) {
  const { models, loading, refresh } = useModels();

  return (
    <div className={"flex items-center gap-1 " + (className ?? "")}>
      <input
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="モデルを選択 / 入力"
        spellCheck={false}
        className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-[#1e1e1e] px-2 py-1 text-xs text-neutral-100 outline-none focus:border-blue-500"
      />
      <datalist id={listId}>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </datalist>
      <button
        onClick={refresh}
        title="モデル一覧を更新"
        className="rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
      >
        {loading ? "…" : "⟳"}
      </button>
    </div>
  );
}
