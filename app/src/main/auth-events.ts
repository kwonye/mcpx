import { BrowserWindow } from "electron";
import { IPC } from "../shared/ipc-channels";

export interface PendingAuthEntry {
  serverName: string;
  oauthLikely?: boolean;
  status?: number;
}

let pendingAuth: PendingAuthEntry[] = [];

function broadcastAuthRequired(entry: PendingAuthEntry): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC.AUTH_REQUIRED, entry);
  }
}

export function queuePendingAuth(entry: PendingAuthEntry): void {
  pendingAuth = [
    entry,
    ...pendingAuth.filter((existing) => existing.serverName !== entry.serverName)
  ];
  broadcastAuthRequired(entry);
}

export function getPendingAuth(): PendingAuthEntry[] {
  return pendingAuth;
}

export function dismissPendingAuth(serverName: string): void {
  pendingAuth = pendingAuth.filter((entry) => entry.serverName !== serverName);
}
