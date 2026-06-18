import { useCallback, useEffect, useState } from "react";

export function useStatus() {
  const [status, setStatus] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // Only show loading indicator if we don't have status yet
    if (!status) setLoading(true);
    try {
      const result = await window.mcpx.getStatus();
      setStatus(result);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { status, loading, refresh };
}
