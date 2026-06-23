import { useEffect, useState } from "react";

/** Boolean state backed by localStorage so UI toggles survive restarts. */
export function usePersistentBool(key: string, initial: boolean) {
  const [value, setValue] = useState<boolean>(() => {
    const stored = localStorage.getItem(key);
    return stored === null ? initial : stored === "1";
  });
  useEffect(() => {
    localStorage.setItem(key, value ? "1" : "0");
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
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }, [key, value]);
  return [value, setValue] as const;
}
