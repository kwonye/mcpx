import { useEffect } from "react";
import type { ManagementSnapshot } from "../../shared/ipc-contract";
import { api } from "../lib/api";
import { invalidate, useQuery } from "../lib/query";
import { STATUS_KEY } from "./useServers";
import { MARKETPLACES_KEY, PLUGINS_KEY, SKILLS_KEY } from "./useAddons";

export const MANAGEMENT_KEY = "management";

/** Harnesses, adoption state and the operations log from the local management service. */
export function useManagementSnapshot() {
  return useQuery<ManagementSnapshot>(MANAGEMENT_KEY, () => api().management.snapshot());
}

/**
 * The service broadcasts whenever anything changes (including changes made
 * from the CLI). Refresh what's on screen, coalescing bursts.
 */
export function useManagementEvents(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = api().management.onChange(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void invalidate(MANAGEMENT_KEY, STATUS_KEY, PLUGINS_KEY, SKILLS_KEY, MARKETPLACES_KEY);
      }, 150);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);
}
