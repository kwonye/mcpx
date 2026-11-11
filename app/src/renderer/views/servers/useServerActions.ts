import type { StatusReport } from "@mcpx/core";
import { api } from "../../lib/api";
import { setQueryData, useMutation } from "../../lib/query";
import { refreshStatus, STATUS_KEY } from "../../hooks/useServers";

function patchServer(name: string, patch: { enabled: boolean }) {
  setQueryData<StatusReport>(STATUS_KEY, (current) => current && {
    ...current,
    servers: current.servers.map((server) => (server.name === name ? { ...server, ...patch } : server))
  });
}

/** Enable/disable with an optimistic switch; reverts (via refresh) on failure. */
export function useServerToggle(name: string) {
  return useMutation(async (enabled: boolean) => {
    patchServer(name, { enabled });
    try {
      await api().servers.setEnabled(name, enabled);
    } finally {
      await refreshStatus();
    }
  });
}
