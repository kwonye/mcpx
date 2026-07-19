import { useCallback, useEffect, useRef, useState } from "react";
import type { StatusReport } from "@mcpx/core";

let inFlight: Promise<unknown> | null = null;

export function useStatus() {
  const [status, setStatus] = useState<StatusReport | null>(null);
  const [loading, setLoading] = useState(true);
  const hasStatus = useRef(false);

  const refresh = useCallback(async () => {
    // Dedupe concurrent calls
    if (inFlight) return inFlight;
    if (!hasStatus.current) setLoading(true);
    const promise = window.mcpx.getStatus().then((result) => {
      setStatus(result);
      hasStatus.current = true;
      return result;
    }).catch((e) => {
      console.error(e);
      return null;
    }).finally(() => {
      inFlight = null;
      setLoading(false);
    });
    inFlight = promise;
    return promise;
  }, []);

  useEffect(() => {
    refresh();

    // Refetch on window focus
    const onFocus = () => { refresh(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  return { status, loading, refresh };
}
