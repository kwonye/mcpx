import { useCallback, useEffect, useRef, useState } from "react";

export function useStatus() {
  const [status, setStatus] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // Only show loading indicator if we don't have status yet
    if (!status) setLoading(true);
    try {
      const result = await window.mcpx.getStatus();
      setStatus(result);
    } finally {
      setLoading(false);
    }
  }, [status]);

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
  const currentQueryRef = useRef<string | undefined>();

  const search = useCallback(async (query?: string) => {
    const normalizedQuery = query?.trim();
    const requestId = ++requestIdRef.current;
    currentQueryRef.current = normalizedQuery;
    setLoading(true);
    try {
      const limit = normalizedQuery ? 200 : 100;
      const result = await window.mcpx.registryList(undefined, normalizedQuery || undefined, limit);
      if (requestId !== requestIdRef.current) return;
      
      const newServers = result.servers ?? [];
      const seen = new Set();
      const deduped = newServers.filter((s: any) => {
        if (seen.has(s.server.name)) return false;
        seen.add(s.server.name);
        return true;
      });

      setServers(deduped);
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
    if (!cursor || loading) return;
    const normalizedQuery = query?.trim() || currentQueryRef.current;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const limit = normalizedQuery ? 200 : 100;
      const result = await window.mcpx.registryList(cursor, normalizedQuery || undefined, limit);
      if (requestId !== requestIdRef.current) return;
      
      setServers((prev) => {
        const next = [...prev, ...(result.servers ?? [])];
        const seen = new Set();
        return next.filter((s: any) => {
          if (seen.has(s.server.name)) return false;
          seen.add(s.server.name);
          return true;
        });
      });
      setCursor(result.metadata?.nextCursor ?? undefined);
    } catch (err) {
      console.error("Registry loadMore error:", err);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [cursor, loading]);

  // Initial load
  useEffect(() => {
    search(undefined);
  }, [search]);

  return { 
    servers, 
    loading, 
    search, 
    loadMore, 
    hasMore: Boolean(cursor) 
  };
}
