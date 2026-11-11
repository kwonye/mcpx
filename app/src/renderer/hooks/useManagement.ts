import { useCallback, useEffect, useRef, useState } from "react";
import type { ManagementSnapshot } from "@mcpx/core";

export function useManagement() {
  const [snapshot, setSnapshot] = useState<ManagementSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pending = useRef<Promise<void> | null>(null);
  const refresh = useCallback(() => {
    if (pending.current) return pending.current;
    pending.current = window.mcpx.management.snapshot().then(result => { setSnapshot(result); setError(null); }).catch(error => { setError(error instanceof Error ? error.message : "Could not reach mcpx"); }).finally(() => { pending.current = null; setLoading(false); });
    return pending.current;
  }, []);
  useEffect(() => {
    void refresh();
    let debounce: ReturnType<typeof setTimeout>;
    const unsubscribe = window.mcpx.management.onChange(() => { clearTimeout(debounce); debounce = setTimeout(() => { void refresh(); }, 100); });
    const timer = setInterval(() => { void refresh(); }, 10000);
    return () => { unsubscribe(); clearTimeout(debounce); clearInterval(timer); };
  }, [refresh]);
  return { snapshot, error, loading, refresh };
}
