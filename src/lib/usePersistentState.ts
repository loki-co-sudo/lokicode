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
