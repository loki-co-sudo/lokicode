import { useCallback, useEffect, useState } from "react";
import { checkForUpdate, installUpdate, relaunchApp, type Update } from "../lib/updater";

type Phase = "idle" | "checking" | "available" | "downloading" | "ready" | "uptodate" | "error";

/**
 * Silent update check on startup; shows an in-app banner when a newer version
 * is published on GitHub Releases. Also exposes a manual "更新を確認" trigger
 * via the `manualNonce` prop (bump it to force a visible check).
 */
export default function UpdateBanner({ manualNonce }: { manualNonce: number }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const runCheck = useCallback(async (manual: boolean) => {
    setPhase("checking");
    setError(null);
    const u = await checkForUpdate();
    if (u) {
      setUpdate(u);
      setDismissed(false);
      setPhase("available");
    } else {
      // On a silent startup check, stay invisible when already current.
      setPhase(manual ? "uptodate" : "idle");
    }
  }, []);

  // Silent check once on mount.
  useEffect(() => {
    runCheck(false);
  }, [runCheck]);

  // Manual checks triggered from Settings (skip the very first render).
  useEffect(() => {
    if (manualNonce > 0) runCheck(true);
  }, [manualNonce, runCheck]);

  const doInstall = useCallback(async () => {
    if (!update) return;
    setPhase("downloading");
    setError(null);
    try {
      await installUpdate(update, (downloaded, total) => {
        if (total) setPct(Math.round((downloaded / total) * 100));
      });
      setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [update]);

  if (phase === "idle" || phase === "checking") return null;
  if (dismissed && phase !== "ready") return null;

  let body: React.ReactNode = null;
  if (phase === "available" && update) {
    body = (
      <>
        <span>
          新しいバージョン <b>v{update.version}</b> があります（現在 v{update.currentVersion}）。
        </span>
        <button onClick={doInstall} className="rounded bg-white/20 px-2 py-0.5 hover:bg-white/30">
          今すぐ更新して再起動
        </button>
        <button onClick={() => setDismissed(true)} className="rounded px-2 py-0.5 hover:bg-white/20">
          後で
        </button>
      </>
    );
  } else if (phase === "downloading") {
    body = <span>ダウンロード中… {pct}%</span>;
  } else if (phase === "ready") {
    body = (
      <>
        <span>更新を適用しました。再起動すると新しいバージョンになります。</span>
        <button onClick={relaunchApp} className="rounded bg-white/20 px-2 py-0.5 hover:bg-white/30">
          今すぐ再起動
        </button>
      </>
    );
  } else if (phase === "uptodate") {
    body = (
      <>
        <span>最新バージョンです。</span>
        <button onClick={() => setDismissed(true)} className="rounded px-2 py-0.5 hover:bg-white/20">
          閉じる
        </button>
      </>
    );
  } else if (phase === "error") {
    body = (
      <>
        <span>更新に失敗しました: {error}</span>
        <button onClick={() => setDismissed(true)} className="rounded px-2 py-0.5 hover:bg-white/20">
          閉じる
        </button>
      </>
    );
  }

  const tone = phase === "error" ? "bg-red-700" : phase === "uptodate" ? "bg-neutral-700" : "bg-blue-700";

  return (
    <div className={`flex items-center gap-3 px-3 py-1.5 text-xs text-white ${tone}`}>
      <span>⬆️</span>
      {body}
    </div>
  );
}
