import { useEffect, useState } from "react";
import { getSettings, saveSettings, type SettingsStatus } from "../lib/openrouter";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function SettingsModal({ open, onClose, onSaved }: SettingsModalProps) {
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    getSettings().then((s) => {
      setStatus(s);
      setModel(s.model);
      setApiKey(""); // never prefill the secret
    });
  }, [open]);

  if (!open) return null;

  async function handleSave() {
    setSaving(true);
    try {
      // Only overwrite the key if the user typed a new one.
      await saveSettings(apiKey.trim() ? apiKey.trim() : undefined, model.trim());
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[460px] max-w-[90vw] rounded-lg border border-neutral-700 bg-[#252526] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-base font-semibold text-neutral-100">設定</h2>
        <p className="mb-4 text-xs text-neutral-500">
          API キーは OS のアプリ設定フォルダに保存され、フロントエンドには公開されません。
        </p>

        <label className="mb-1 block text-sm text-neutral-300">OpenRouter API キー</label>
        <input
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            status?.hasKey
              ? status.keySource === "env"
                ? "環境変数 (.env) に設定済み — 上書きする場合のみ入力"
                : "保存済み — 変更する場合のみ入力"
              : "sk-or-..."
          }
          className="mb-4 w-full rounded-md border border-neutral-700 bg-[#1e1e1e] px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
        />

        <label className="mb-1 block text-sm text-neutral-300">モデル</label>
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="anthropic/claude-3.5-sonnet"
          className="mb-5 w-full rounded-md border border-neutral-700 bg-[#1e1e1e] px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
        />

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
