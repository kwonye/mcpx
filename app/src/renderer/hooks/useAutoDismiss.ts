import { useCallback, useEffect, useRef, useState } from "react";

/** Shared delay (ms) after which transient feedback messages auto-dismiss. */
export const AUTO_DISMISS_DELAY_MS = 6000;

/**
 * Like useState, but setting a non-null value schedules an automatic
 * reset back to null after `delayMs`. Setting a new value (including
 * clearing it back to null) cancels any pending timer; unmounting does too.
 */
export function useAutoDismiss<T>(delayMs: number): [T | null, (value: T | null) => void] {
  const [value, setValue] = useState<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const setAutoDismissValue = useCallback((next: T | null) => {
    clearPendingTimer();
    setValue(next);
    if (next !== null) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setValue(null);
      }, delayMs);
    }
  }, [clearPendingTimer, delayMs]);

  useEffect(() => clearPendingTimer, [clearPendingTimer]);

  return [value, setAutoDismissValue];
}
