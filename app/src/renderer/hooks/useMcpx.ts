import { useCallback, useEffect, useRef, useState } from "react";

export function useStatus() {
  const [status, setStatus] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await window.mcpx.getStatus();
    setStatus(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { status, loading, refresh };
}

export function useRegistryList() {
  const [servers, setServers] = useState<unknown[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  const search = useCallback(async (query?: string) => {
    const normalizedQuery = query?.trim();
    const requestId = ++requestIdRef.current;
    console.log("[useMcpx.search] called with query:", normalizedQuery);
    setLoading(true);
    try {
      const result = await window.mcpx.registryList(undefined, normalizedQuery || undefined);
      if (requestId !== requestIdRef.current) return;
      console.log("[useMcpx.search] search result:", result);
      setServers(result.servers ?? []);
      setCursor(result.metadata?.nextCursor ?? undefined);
    } catch (err) {
      console.error("Registry search error:", err);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const loadMore = useCallback(async (query?: string) => {
    if (!cursor) return;
    const normalizedQuery = query?.trim();
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const result = await window.mcpx.registryList(cursor, normalizedQuery || undefined);
      if (requestId !== requestIdRef.current) return;
      setServers((prev) => [...prev, ...(result.servers ?? [])]);
      setCursor(result.metadata?.nextCursor ?? undefined);
    } catch (err) {
      console.error("Registry loadMore error:", err);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [cursor]);

  return { servers, loading, search, loadMore, hasMore: Boolean(cursor) };
}
