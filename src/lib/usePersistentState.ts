import { useEffect, useState } from "react";

/** Persist a key safely. localStorage can throw (private mode, quota full) —
 * a UI preference write must never crash the app, so swallow failures. */
function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage full / unavailable — non-fatal
  }
}

function safeRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/** Boolean state backed by localStorage so UI toggles survive restarts. */
export function usePersistentBool(key: string, initial: boolean) {
  const [value, setValue] = useState<boolean>(() => {
    const stored = localStorage.getItem(key);
    return stored === null ? initial : stored === "1";
  });
  useEffect(() => {
    safeSet(key, value ? "1" : "0");
  }, [key, value]);
  return [value, setValue] as const;
}

/** Nullable string state backed by localStorage (e.g. the open workspace path). */
export function usePersistentString(key: string, initial: string | null) {
  const [value, setValue] = useState<string | null>(() => {
    const stored = localStorage.getItem(key);
    return stored === null ? initial : stored;
  });
  useEffect(() => {
    if (value === null) safeRemove(key);
    else safeSet(key, value);
  }, [key, value]);
  return [value, setValue] as const;
}
