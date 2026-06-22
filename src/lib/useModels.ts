import { useCallback, useEffect, useState } from "react";
import { listModels, type ModelInfo } from "./openrouter";

/** Shared hook that loads the (auto-updating) OpenRouter model list. */
export function useModels() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      setModels(await listModels(force));
    } catch {
      // ignore — picker still allows manual entry
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  return { models, loading, refresh: () => load(true) };
}
