import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import { IPC } from "../shared/ipc-channels";
import type { DesktopSettingsPatch } from "../shared/desktop-settings";

const ALLOWED_CHANNELS = new Set<string>(Object.values(IPC));
const REMOTE_ERROR_PREFIX = /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/;

function invokeIpc(channel: string, ...args: unknown[]) {
  return ipcRenderer.invoke(channel, ...args).catch((error: unknown) => {
    if (error instanceof Error) {
      error.message = error.message.replace(REMOTE_ERROR_PREFIX, "");
    }
    throw error;
  });
}

const api = {
  getStatus: () => invokeIpc(IPC.GET_STATUS),
  getServers: () => invokeIpc(IPC.GET_SERVERS),
  getDesktopSettings: () => invokeIpc(IPC.GET_DESKTOP_SETTINGS),
  addServer: (name: string, spec: unknown) => invokeIpc(IPC.ADD_SERVER, name, spec),
  updateServer: (name: string, spec: unknown, resolvedSecrets?: Record<string, string>) => invokeIpc(IPC.UPDATE_SERVER, name, spec, resolvedSecrets),
  removeServer: (name: string) => invokeIpc(IPC.REMOVE_SERVER, name),
  setServerEnabled: (name: string, enabled: boolean) => invokeIpc(IPC.SET_SERVER_ENABLED, name, enabled),
  updateDesktopSettings: (patch: DesktopSettingsPatch) => invokeIpc(IPC.UPDATE_DESKTOP_SETTINGS, patch),
  checkForUpdates: () => invokeIpc(IPC.CHECK_FOR_UPDATES),
  syncAll: () => invokeIpc(IPC.SYNC_ALL),
  daemonStart: () => invokeIpc(IPC.DAEMON_START),
  daemonStop: () => invokeIpc(IPC.DAEMON_STOP),
  daemonRestart: () => invokeIpc(IPC.DAEMON_RESTART),
  openDashboard: () => invokeIpc(IPC.OPEN_DASHBOARD),
  quitApp: () => invokeIpc(IPC.QUIT_APP),
  getPendingAuth: () => invokeIpc(IPC.GET_PENDING_AUTH),
  onAuthRequired: (callback: (entry: { serverName: string; oauthLikely?: boolean; status?: number }) => void) => {
    const listener = (_event: IpcRendererEvent, entry: { serverName: string; oauthLikely?: boolean; status?: number }) => callback(entry);
    ipcRenderer.on(IPC.AUTH_REQUIRED, listener);
    return () => ipcRenderer.removeListener(IPC.AUTH_REQUIRED, listener);
  },
  startOauth: (serverName: string) => invokeIpc(IPC.START_OAUTH, serverName),
  dismissAuth: (serverName: string) => invokeIpc(IPC.DISMISS_AUTH, serverName),
  skills: {
    list: () => invokeIpc(IPC.LIST_SKILLS),
    get: (id: string) => invokeIpc(IPC.GET_SKILL, id),
    save: (id: string, content: string) => invokeIpc(IPC.SAVE_SKILL, id, content),
    delete: (id: string) => invokeIpc(IPC.DELETE_SKILL, id)
  },
  plugins: {
    inspect: (source: string) => invokeIpc(IPC.PLUGIN_INSPECT, source),
    install: (source: string, options?: unknown) => invokeIpc(IPC.PLUGIN_INSTALL, source, options),
    prepare: (name: string) => invokeIpc(IPC.PLUGIN_PREPARE, name),
    update: (name: string) => invokeIpc(IPC.PLUGIN_UPDATE, name),
    uninstall: (name: string, options?: unknown) => invokeIpc(IPC.PLUGIN_UNINSTALL, name, options),
    enable: (name: string) => invokeIpc(IPC.PLUGIN_ENABLE, name),
    disable: (name: string) => invokeIpc(IPC.PLUGIN_DISABLE, name),
    setProjectOverride: (name: string, projectPath: string, override: { enabled?: boolean; components?: Partial<Record<string, boolean>> }) =>
      invokeIpc(IPC.PLUGIN_SET_PROJECT_OVERRIDE, name, projectPath, override),
    resetProjectOverride: (name: string, projectPath: string) =>
      invokeIpc(IPC.PLUGIN_RESET_PROJECT_OVERRIDE, name, projectPath),
    approve: (name: string, component: string) => invokeIpc(IPC.PLUGIN_APPROVE, name, component),
    configSet: (name: string, key: string, value: string, options?: unknown) =>
      invokeIpc(IPC.PLUGIN_CONFIG_SET, name, key, value, options),
    sync: (name?: string, options?: unknown) => invokeIpc(IPC.PLUGIN_SYNC, name, options),
    status: (name?: string) => invokeIpc(IPC.PLUGIN_STATUS, name),
    list: () => invokeIpc(IPC.PLUGIN_LIST)
  },
  projectInit: (projectPath: string, name: string) => invokeIpc(IPC.PROJECT_INIT, projectPath, name),
  projectRemove: (projectPath: string) => invokeIpc(IPC.PROJECT_REMOVE, projectPath),
  setProjectServerEnabled: (projectPath: string, serverName: string, enabled: boolean) =>
    invokeIpc(IPC.PROJECT_SET_SERVER_ENABLED, projectPath, serverName, enabled),
  selectDirectory: () => invokeIpc(IPC.SELECT_DIRECTORY) as Promise<string | null>,
  invoke: (channel: string, ...args: unknown[]) => {
    if (!ALLOWED_CHANNELS.has(channel)) {
      throw new Error(`Unknown IPC channel: ${channel}`);
    }
    return invokeIpc(channel, ...args);
  }
};

contextBridge.exposeInMainWorld("mcpx", api);

export type McpxApi = typeof api;
