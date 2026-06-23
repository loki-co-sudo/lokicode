import { useEffect, useState } from "react";
import { getSettings, saveSettings, type SettingsStatus } from "../lib/openrouter";
import {
  loadKeybindings,
  saveKeybindings,
  comboFromEvent,
  ACTION_LABELS,
  DEFAULT_KEYS,
  type ActionId,
} from "../lib/keybindings";
import ModelPicker from "./ModelPicker";
import GithubAccount from "./GithubAccount";

/** Settings as a left-sidebar pane (activity bar → gear). Covers every option. */
export default function SettingsPane({ onSaved }: { onSaved: () => void }) {
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [thinkingModel, setThinkingModel] = useState("");
  const [synthesisModel, setSynthesisModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [keys, setKeys] = useState(() => loadKeybindings());
  const [capturing, setCapturing] = useState<ActionId | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setKeys(loadKeybindings());
    getSettings().then((s) => {
      setStatus(s);
      setModel(s.model);
      setThinkingModel(s.thinkingModel);
      setSynthesisModel(s.synthesisModel);
      setBaseUrl(s.baseUrl);
      setApiKey("");
    });
  }, []);

  useEffect(() => {
    if (!capturing) return;
    const action = capturing;
    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      const combo = comboFromEvent(e);
      if (!combo) return;
      setKeys((k) => ({ ...k, [action]: combo }));
      setCapturing(null);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing]);

  async function handleSave() {
    await saveSettings({
      apiKey: apiKey.trim() ? apiKey.trim() : undefined,
      model: model.trim(),
      thinkingModel: thinkingModel.trim(),
      synthesisModel: synthesisModel.trim(),
      baseUrl: baseUrl.trim(),
    });
    saveKeybindings(keys);
    onSaved();
    setSaved(true);
    setApiKey("");
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="flex h-full flex-col bg-[#1b1b1c]">
      <div className="flex items-center justify-between border-b border-neutral-800 bg-[#252526] px-2 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">設定</span>
        <button
          onClick={handleSave}
          className="rounded bg-blue-600 px-3 py-0.5 text-xs font-medium text-white hover:bg-blue-500"
        >
          {saved ? "保存しました" : "保存"}
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3 text-xs">
        <div>
          <label className="mb-1 block text-neutral-300">OpenRouter API キー</label>
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              status?.hasKey
                ? status.keySource === "env"
                  ? "環境変数 (.env) に設定済み"
                  : "保存済み — 変更時のみ入力"
                : "sk-or-..."
            }
            className="w-full rounded-md border border-neutral-700 bg-[#1e1e1e] px-2 py-1.5 text-neutral-100 outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-neutral-300">API ベース URL（任意）</label>
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="空欄で OpenRouter / Ollama 例 http://localhost:11434/v1"
            className="w-full rounded-md border border-neutral-700 bg-[#1e1e1e] px-2 py-1.5 text-neutral-100 outline-none focus:border-blue-500"
          />
          <p className="mt-1 text-[11px] text-neutral-500">
            OpenAI 互換エンドポイントでローカル LLM や他プロバイダを利用（指定時はキー任意）。
          </p>
        </div>

        <div>
          <label className="mb-1 block text-neutral-300">モデル（既定）</label>
          <ModelPicker value={model} onChange={setModel} listId="settings-models" />
        </div>

        <div className="rounded-md border border-indigo-800/40 bg-indigo-950/20 p-2">
          <p className="mb-2 font-medium text-indigo-300">🧠 ディープ推論のモデル</p>
          <label className="mb-1 block text-[11px] text-neutral-400">思考モデル（軽量・空欄で既定）</label>
          <ModelPicker value={thinkingModel} onChange={setThinkingModel} listId="settings-thinking" className="mb-2" />
          <label className="mb-1 block text-[11px] text-neutral-400">合成モデル（高性能・空欄で既定）</label>
          <ModelPicker value={synthesisModel} onChange={setSynthesisModel} listId="settings-synthesis" />
        </div>

        <div className="rounded-md border border-neutral-700 bg-[#1e1e1e] p-2">
          <p className="mb-2 font-medium text-neutral-300">キーボードショートカット</p>
          <div className="space-y-1">
            {(Object.keys(ACTION_LABELS) as ActionId[]).map((a) => (
              <div key={a} className="flex items-center gap-2">
                <span className="flex-1 truncate text-neutral-400">{ACTION_LABELS[a]}</span>
                <button
                  onClick={() => setCapturing(a)}
                  className={
                    "rounded border px-2 py-0.5 font-mono " +
                    (capturing === a
                      ? "border-blue-500 bg-blue-600/20 text-blue-200"
                      : "border-neutral-700 bg-[#252526] text-neutral-200 hover:border-neutral-600")
                  }
                >
                  {capturing === a ? "キーを押す…" : keys[a]}
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => setKeys({ ...DEFAULT_KEYS })}
            className="mt-2 text-[11px] text-neutral-500 hover:text-neutral-300"
          >
            既定に戻す
          </button>
        </div>

        <GithubAccount />
      </div>
    </div>
  );
}
