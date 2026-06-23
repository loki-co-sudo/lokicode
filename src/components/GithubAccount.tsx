import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  githubDeviceStart,
  githubDevicePoll,
  githubUser,
  githubLogout,
  type DeviceCode,
  type GithubUser,
} from "../lib/github";

type Phase = "loading" | "loggedOut" | "pending" | "loggedIn" | "error";

/** GitHub account section: OAuth Device Flow login, user display, logout. */
export default function GithubAccount({ onChange }: { onChange?: () => void }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [user, setUser] = useState<GithubUser | null>(null);
  const [device, setDevice] = useState<DeviceCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => {
    githubUser()
      .then((u) => {
        setUser(u);
        setPhase(u ? "loggedIn" : "loggedOut");
      })
      .catch(() => setPhase("loggedOut"));
    return stopPolling;
  }, [stopPolling]);

  const poll = useCallback(
    (deviceCode: string, intervalMs: number) => {
      pollTimer.current = window.setTimeout(async () => {
        try {
          const r = await githubDevicePoll(deviceCode);
          if (r.status === "ok") {
            stopPolling();
            setUser(r.user);
            setDevice(null);
            setPhase("loggedIn");
            onChange?.();
          } else if (r.status === "pending") {
            poll(deviceCode, intervalMs);
          } else if (r.status === "slowDown") {
            poll(deviceCode, intervalMs + 5000);
          } else {
            stopPolling();
            setError(r.message);
            setPhase("error");
          }
        } catch (e) {
          stopPolling();
          setError(e instanceof Error ? e.message : String(e));
          setPhase("error");
        }
      }, intervalMs);
    },
    [onChange, stopPolling],
  );

  const login = useCallback(async () => {
    setError(null);
    try {
      const d = await githubDeviceStart();
      if (d.notConfigured) {
        setError(
          "GitHub OAuth App が未設定です。オーナーが Client ID を登録する必要があります（README 参照）。",
        );
        setPhase("error");
        return;
      }
      setDevice(d);
      setPhase("pending");
      await openUrl(d.verificationUri).catch(() => {});
      poll(d.deviceCode, d.interval * 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [poll]);

  const logout = useCallback(async () => {
    await githubLogout();
    setUser(null);
    setPhase("loggedOut");
    onChange?.();
  }, [onChange]);

  return (
    <div className="rounded-md border border-neutral-700 bg-[#1e1e1e] p-3">
      <p className="mb-2 text-xs font-medium text-neutral-300">GitHub アカウント連携</p>

      {phase === "loading" && <p className="text-xs text-neutral-500">確認中…</p>}

      {phase === "loggedIn" && user && (
        <div className="flex items-center gap-2">
          {user.avatarUrl && (
            <img src={user.avatarUrl} alt="" className="h-7 w-7 rounded-full" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-neutral-100">{user.name || user.login}</div>
            <div className="truncate text-xs text-neutral-500">@{user.login}</div>
          </div>
          <button
            onClick={logout}
            className="rounded px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
          >
            ログアウト
          </button>
        </div>
      )}

      {phase === "loggedOut" && (
        <button
          onClick={login}
          className="rounded bg-neutral-800 px-3 py-1.5 text-xs text-neutral-100 hover:bg-neutral-700"
        >
          GitHub でログイン
        </button>
      )}

      {phase === "pending" && device && (
        <div className="space-y-1 text-xs text-neutral-300">
          <p>ブラウザで以下のコードを入力して許可してください:</p>
          <p className="font-mono text-lg tracking-widest text-emerald-400">{device.userCode}</p>
          <p className="text-neutral-500">
            開かない場合:{" "}
            <button onClick={() => openUrl(device.verificationUri)} className="text-blue-400 underline">
              {device.verificationUri}
            </button>
          </p>
          <p className="text-neutral-500">承認を待っています…</p>
        </div>
      )}

      {phase === "error" && (
        <div className="space-y-2 text-xs">
          <p className="text-red-400">{error}</p>
          <button
            onClick={() => setPhase(user ? "loggedIn" : "loggedOut")}
            className="rounded px-2 py-1 text-neutral-300 hover:bg-neutral-700"
          >
            戻る
          </button>
        </div>
      )}

      <p className="mt-2 text-[11px] text-neutral-600">
        トークンは OS のアプリ設定フォルダに保存され、push/pull の認証に使われます。
      </p>
    </div>
  );
}
