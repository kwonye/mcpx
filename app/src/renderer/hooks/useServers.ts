import { useMemo } from "react";
import type { StatusReport, StatusServerEntry } from "@mcpx/core";
import type { PendingAuthEntry, TokenCount, TokenCountsReport } from "../../shared/ipc-contract";
import { api } from "../lib/api";
import { deriveServerState, SERVER_STATE_ORDER, type ServerState } from "../lib/domain";
import { invalidate, useQuery } from "../lib/query";
import { usePendingAuth } from "./usePendingAuth";

export const STATUS_KEY = "status";
export const TOKENS_KEY = "tokens";

export function useStatus() {
  return useQuery<StatusReport>(STATUS_KEY, () => api().status.get());
}

/** Context cost from the running gateway. Slow; never blocks rendering. */
export function useTokenCounts(enabled: boolean) {
  return useQuery<TokenCountsReport>(TOKENS_KEY, () => api().status.tokenCounts(), { enabled });
}

/** Refresh status now and context cost in the background. */
export function refreshStatus(): Promise<unknown> {
  void invalidate(TOKENS_KEY);
  return invalidate(STATUS_KEY);
}

export interface ServerView extends StatusServerEntry {
  state: ServerState;
  tokens?: TokenCount;
  pendingAuth?: PendingAuthEntry;
}

export function buildServerViews(
  servers: StatusServerEntry[],
  counts: TokenCountsReport | undefined,
  pending: PendingAuthEntry[],
  gatewayRunning: boolean,
  countsLoading: boolean
): ServerView[] {
  return servers.map((server) => {
    const tokens = gatewayRunning && counts?.gatewayRunning ? counts.counts[server.name] : undefined;
    const pendingAuth = pending.find((entry) => entry.serverName === server.name);
    return {
      ...server,
      tokens,
      pendingAuth,
      state: deriveServerState({ enabled: server.enabled, tokenCount: tokens, pendingSignIn: Boolean(pendingAuth), gatewayRunning, countsLoading })
    };
  });
}

export function sortByAttention(servers: ServerView[]): ServerView[] {
  return [...servers].sort((a, b) => SERVER_STATE_ORDER[a.state.kind] - SERVER_STATE_ORDER[b.state.kind] || a.name.localeCompare(b.name));
}

export function useServers() {
  const status = useStatus();
  const gatewayRunning = Boolean(status.data?.daemon.running);
  const tokens = useTokenCounts(gatewayRunning);
  const pending = usePendingAuth();
  const servers = useMemo(
    () => buildServerViews(status.data?.servers ?? [], tokens.data, pending, gatewayRunning, tokens.fetching),
    [status.data, tokens.data, tokens.fetching, pending, gatewayRunning]
  );
  return { status, tokens, servers, pending, gatewayRunning };
}
