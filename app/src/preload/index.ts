import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/ipc-channels";
import type { DesktopSettingsPatch } from "../shared/desktop-settings";

const api = {
  getStatus: () => ipcRenderer.invoke(IPC.GET_STATUS),
  getServers: () => ipcRenderer.invoke(IPC.GET_SERVERS),
  getDesktopSettings: () => ipcRenderer.invoke(IPC.GET_DESKTOP_SETTINGS),
  addServer: (name: string, spec: unknown) => ipcRenderer.invoke(IPC.ADD_SERVER, name, spec),
  updateServer: (name: string, spec: unknown, resolvedSecrets?: Record<string, string>) => ipcRenderer.invoke(IPC.UPDATE_SERVER, name, spec, resolvedSecrets),
  removeServer: (name: string) => ipcRenderer.invoke(IPC.REMOVE_SERVER, name),
  setServerEnabled: (name: string, enabled: boolean) => ipcRenderer.invoke(IPC.SET_SERVER_ENABLED, name, enabled),
  updateDesktopSettings: (patch: DesktopSettingsPatch) => ipcRenderer.invoke(IPC.UPDATE_DESKTOP_SETTINGS, patch),
  checkForUpdates: () => ipcRenderer.invoke(IPC.CHECK_FOR_UPDATES),
  syncAll: () => ipcRenderer.invoke(IPC.SYNC_ALL),
  daemonStart: () => ipcRenderer.invoke(IPC.DAEMON_START),
  daemonStop: () => ipcRenderer.invoke(IPC.DAEMON_STOP),
  daemonRestart: () => ipcRenderer.invoke(IPC.DAEMON_RESTART),
  registryList: (cursor?: string, query?: string, limit?: number) => ipcRenderer.invoke(IPC.REGISTRY_LIST, cursor ?? null, query ?? null, limit ?? null),
  registryGet: (name: string) => ipcRenderer.invoke(IPC.REGISTRY_GET, name),
  registryPrepareAdd: (registryName: string) => ipcRenderer.invoke(IPC.REGISTRY_PREPARE_ADD, registryName),
  registryConfirmAdd: (resolvedValues: Record<string, string>) => ipcRenderer.invoke(IPC.REGISTRY_CONFIRM_ADD, resolvedValues),
  openDashboard: () => ipcRenderer.invoke(IPC.OPEN_DASHBOARD),
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
};

contextBridge.exposeInMainWorld("mcpx", api);

export type McpxApi = typeof api;
