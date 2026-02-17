import { useCallback, useEffect, useState } from "react";

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

  const search = useCallback(async (query?: string) => {
    setLoading(true);
    const result = await window.mcpx.registryList(undefined, query);
    setServers(result.servers ?? []);
    setCursor(result.metadata?.nextCursor ?? undefined);
    setLoading(false);
  }, []);

  const loadMore = useCallback(async (query?: string) => {
    if (!cursor) return;
    setLoading(true);
    const result = await window.mcpx.registryList(cursor, query);
    setServers((prev) => [...prev, ...(result.servers ?? [])]);
    setCursor(result.metadata?.nextCursor ?? undefined);
    setLoading(false);
  }, [cursor]);

  return { servers, loading, search, loadMore, hasMore: Boolean(cursor) };
}
