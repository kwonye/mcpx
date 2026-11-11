import { useEffect, useSyncExternalStore } from "react";
import type { PendingAuthEntry } from "../../shared/ipc-contract";
import { api } from "../lib/api";

// One shared store per window: main broadcasts the full list on every change.
let entries: PendingAuthEntry[] = [];
const listeners = new Set<() => void>();
let started = false;
let unsubscribe: (() => void) | null = null;

function set(next: PendingAuthEntry[]) {
  entries = next;
  for (const listener of listeners) listener();
}

function start() {
  if (started) return;
  started = true;
  unsubscribe = api().auth.onPendingChanged((next) => set(Array.isArray(next) ? next : []));
  void api().auth.pending().then((initial) => set(Array.isArray(initial) ? initial : [])).catch(() => set([]));
}

/** Test helper. */
export function resetPendingAuthStore() {
  unsubscribe?.();
  unsubscribe = null;
  started = false;
  entries = [];
}

export function usePendingAuth(): PendingAuthEntry[] {
  useEffect(() => {
    start();
  }, []);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => entries
  );
}
