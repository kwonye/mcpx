import { BrowserWindow } from "electron";
import { IPC } from "../shared/ipc-channels";
import type { OAuthSupport } from "@mcpx/core";

export interface PendingAuthEntry {
  serverName: string;
  oauthLikely?: boolean;
  oauthSupport?: OAuthSupport;
  status?: number;
}

let pendingAuth: PendingAuthEntry[] = [];

function broadcastAuthState(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue;
    }
    window.webContents.send(IPC.AUTH_STATE_CHANGED, pendingAuth);
  }
}

export function queuePendingAuth(entry: PendingAuthEntry): void {
  pendingAuth = [
    entry,
    ...pendingAuth.filter((existing) => existing.serverName !== entry.serverName)
  ];
  broadcastAuthState();
}

export function getPendingAuth(): PendingAuthEntry[] {
  return pendingAuth;
}

export function dismissPendingAuth(serverName: string): void {
  const next = pendingAuth.filter((entry) => entry.serverName !== serverName);
  if (next.length === pendingAuth.length) {
    return;
  }
  pendingAuth = next;
  broadcastAuthState();
}

/** Test-only: resets in-memory pending-auth state between tests. */
export function resetPendingAuth(): void {
  pendingAuth = [];
}
