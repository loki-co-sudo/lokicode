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
import {
  getMaxIterations,
  getCommandTimeout,
  setMaxIterations,
  setCommandTimeout,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_COMMAND_TIMEOUT,
  MAX_ITERATIONS_RANGE,
  COMMAND_TIMEOUT_RANGE,
} from "../lib/agentSettings";
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
  const [maxIterations, setMaxIter] = useState(() => getMaxIterations());
  const [commandTimeout, setCmdTimeout] = useState(() => getCommandTimeout());
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setKeys(loadKeybindings());
    setMaxIter(getMaxIterations());
    setCmdTimeout(getCommandTimeout());
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
    setMaxIterations(maxIterations);
    setCommandTimeout(commandTimeout);
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
          <p className="mb-2 font-medium text-neutral-300">エージェントの動作</p>

          <label className="mb-1 block text-[11px] text-neutral-400">
            ループ上限（ツール実行の最大回数）
          </label>
          <input
            type="number"
            min={MAX_ITERATIONS_RANGE[0]}
            max={MAX_ITERATIONS_RANGE[1]}
            value={maxIterations}
            onChange={(e) =>
              setMaxIter(
                Math.max(
                  MAX_ITERATIONS_RANGE[0],
                  Math.min(MAX_ITERATIONS_RANGE[1], Math.floor(Number(e.target.value) || 0)),
                ),
              )
            }
            className="w-24 rounded-md border border-neutral-700 bg-[#1e1e1e] px-2 py-1 text-neutral-100 outline-none focus:border-blue-500"
          />
          <p className="mb-3 mt-1 text-[11px] leading-relaxed text-neutral-500">
            1 回の依頼でエージェントがツール（読み書き・コマンド・検索）を呼べる回数の上限です。
            <b className="text-neutral-400">大きく</b>すると、多ファイルの大きな作業を途中で打ち切られにくくなります（その分コスト・時間は増えます）。
            <b className="text-neutral-400">小さく</b>すると、暴走や使いすぎを早めに止められます。既定 {DEFAULT_MAX_ITERATIONS}（範囲 {MAX_ITERATIONS_RANGE[0]}–{MAX_ITERATIONS_RANGE[1]}）。
          </p>

          <label className="mb-1 block text-[11px] text-neutral-400">
            コマンドのタイムアウト（秒）
          </label>
          <input
            type="number"
            min={COMMAND_TIMEOUT_RANGE[0]}
            max={COMMAND_TIMEOUT_RANGE[1]}
            value={commandTimeout}
            onChange={(e) =>
              setCmdTimeout(
                Math.max(
                  COMMAND_TIMEOUT_RANGE[0],
                  Math.min(COMMAND_TIMEOUT_RANGE[1], Math.floor(Number(e.target.value) || 0)),
                ),
              )
            }
            className="w-24 rounded-md border border-neutral-700 bg-[#1e1e1e] px-2 py-1 text-neutral-100 outline-none focus:border-blue-500"
          />
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
            エージェントが <code className="rounded bg-neutral-700/60 px-1">run_command</code> で実行したコマンドを、この秒数で強制終了します（応答しないプロセスでの固まり防止）。
            <b className="text-neutral-400">長く</b>すると、ビルドやテストなど時間のかかる処理を最後まで待てます。
            <b className="text-neutral-400">短く</b>すると、ハングを早く打ち切れます。既定 {DEFAULT_COMMAND_TIMEOUT} 秒（範囲 {COMMAND_TIMEOUT_RANGE[0]}–{COMMAND_TIMEOUT_RANGE[1]}）。下部の統合ターミナルには影響しません。
          </p>
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
