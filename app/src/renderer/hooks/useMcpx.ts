import { useCallback, useEffect, useRef, useState } from "react";
import type { StatusReport } from "@mcpx/core";



export function useStatus() {
  const [status, setStatus] = useState<StatusReport | null>(null);
  const [loading, setLoading] = useState(true);
  const hasStatus = useRef(false);
  const inFlight = useRef<Promise<StatusReport | null> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    // Dedupe concurrent calls
    if (inFlight.current) return inFlight.current;
    if (!hasStatus.current) setLoading(true);
    const promise = window.mcpx.getStatus().then((result) => {
      setStatus(result);
      setError(null);
      hasStatus.current = true;
      return result;
    }).catch((e) => {
      setError(e instanceof Error ? e.message : "Could not reach mcpx");
      return null;
    }).finally(() => {
      inFlight.current = null;
      setLoading(false);
    });
    inFlight.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    refresh();

    // Refetch on window focus
    const onFocus = () => { refresh(); };
    window.addEventListener("focus", onFocus);
    const unsubscribe = window.mcpx.management?.onChange(onFocus);
    return () => { window.removeEventListener("focus", onFocus); unsubscribe?.(); };
  }, [refresh]);

  return { status, loading, error, refresh };
}
