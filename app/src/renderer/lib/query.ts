/**
 * A deliberately small query cache: one entry per key, shared across
 * components, stale data kept visible while refreshing, in-flight requests
 * de-duplicated, and window-focus refetches throttled.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

interface Entry {
  data?: unknown;
  error?: unknown;
  promise?: Promise<unknown>;
  fetcher?: () => Promise<unknown>;
  updatedAt: number;
  listeners: Set<() => void>;
  version: number;
}

const cache = new Map<string, Entry>();
/** Refetch on focus only if the data is older than this. */
export const FOCUS_REFETCH_THROTTLE_MS = 30_000;

function entryFor(key: string): Entry {
  let entry = cache.get(key);
  if (!entry) {
    entry = { updatedAt: 0, listeners: new Set(), version: 0 };
    cache.set(key, entry);
  }
  return entry;
}

function notify(entry: Entry): void {
  entry.version += 1;
  for (const listener of entry.listeners) listener();
}

function run(key: string): Promise<unknown> {
  const entry = entryFor(key);
  if (entry.promise) return entry.promise;
  if (!entry.fetcher) return Promise.resolve(entry.data);
  const promise = entry.fetcher()
    .then((data) => {
      entry.data = data;
      entry.error = undefined;
      entry.updatedAt = Date.now();
      return data;
    })
    .catch((error: unknown) => {
      entry.error = error;
      entry.updatedAt = Date.now();
      return entry.data;
    })
    .finally(() => {
      entry.promise = undefined;
      notify(entry);
    });
  entry.promise = promise;
  notify(entry);
  return promise;
}

/** Re-fetch the given keys now (only keys something has fetched before). */
export function invalidate(...keys: string[]): Promise<unknown[]> {
  return Promise.all(keys.map((key) => (cache.get(key)?.fetcher ? run(key) : Promise.resolve())));
}

/** Optimistically replace cached data (e.g. flip a switch before the IPC call returns). */
export function setQueryData<T>(key: string, updater: (current: T | undefined) => T | undefined): void {
  const entry = entryFor(key);
  entry.data = updater(entry.data as T | undefined);
  notify(entry);
}

export function getQueryData<T>(key: string): T | undefined {
  return cache.get(key)?.data as T | undefined;
}

/** Test helper. */
export function resetQueryCache(): void {
  cache.clear();
}

let focusListenerInstalled = false;
function installFocusListener(): void {
  if (focusListenerInstalled || typeof window === "undefined") return;
  focusListenerInstalled = true;
  window.addEventListener("focus", () => {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (entry.listeners.size > 0 && entry.fetcher && now - entry.updatedAt > FOCUS_REFETCH_THROTTLE_MS) void run(key);
    }
  });
}

export interface QueryState<T> {
  data: T | undefined;
  error: unknown;
  /** True only while there is no data yet. */
  loading: boolean;
  /** True whenever a request is in flight (including background refreshes). */
  fetching: boolean;
  refetch: () => Promise<unknown>;
}

export function useQuery<T>(key: string, fetcher: () => Promise<T>, options: { enabled?: boolean } = {}): QueryState<T> {
  const enabled = options.enabled ?? true;
  const entry = entryFor(key);
  entry.fetcher = fetcher as () => Promise<unknown>;

  const subscribe = useCallback((listener: () => void) => {
    const current = entryFor(key);
    current.listeners.add(listener);
    return () => current.listeners.delete(listener);
  }, [key]);
  useSyncExternalStore(subscribe, () => entryFor(key).version);

  useEffect(() => {
    installFocusListener();
    if (!enabled) return;
    const current = entryFor(key);
    if (current.updatedAt === 0 && !current.promise) void run(key);
  }, [key, enabled]);

  const refetch = useCallback(() => run(key), [key]);
  const fetching = Boolean(entry.promise);
  return {
    data: entry.data as T | undefined,
    error: entry.error,
    loading: enabled && entry.data === undefined && (fetching || entry.updatedAt === 0) && !entry.error,
    fetching,
    refetch
  };
}

export type MutationResult<R> = { ok: true; value: R } | { ok: false; error: string };

export interface MutationState<A extends unknown[], R> {
  run: (...args: A) => Promise<MutationResult<R>>;
  pending: boolean;
  error: string | null;
  reset: () => void;
}

/**
 * Wraps an async action with pending/error state. The returned `run` never
 * throws: failures land in `error` (for inline display) and resolve to { ok: false }.
 */
export function useMutation<A extends unknown[], R>(action: (...args: A) => Promise<R>): MutationState<A, R> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const actionRef = useRef(action);
  actionRef.current = action;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const runAction = useCallback(async (...args: A): Promise<MutationResult<R>> => {
    setPending(true);
    setError(null);
    try {
      return { ok: true, value: await actionRef.current(...args) };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (mounted.current) setError(message);
      return { ok: false, error: message };
    } finally {
      if (mounted.current) setPending(false);
    }
  }, []);

  return { run: runAction, pending, error, reset: () => setError(null) };
}
