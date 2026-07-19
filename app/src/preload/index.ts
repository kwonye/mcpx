import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import { IPC } from "../shared/ipc-channels";
import type { DesktopSettingsPatch } from "../shared/desktop-settings";

const ALLOWED_CHANNELS = new Set<string>(Object.values(IPC));

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
  openDashboard: () => ipcRenderer.invoke(IPC.OPEN_DASHBOARD),
  quitApp: () => ipcRenderer.invoke(IPC.QUIT_APP),
  getPendingAuth: () => ipcRenderer.invoke(IPC.GET_PENDING_AUTH),
  onAuthRequired: (callback: (entry: { serverName: string; oauthLikely?: boolean; status?: number }) => void) => {
    const listener = (_event: IpcRendererEvent, entry: { serverName: string; oauthLikely?: boolean; status?: number }) => callback(entry);
    ipcRenderer.on(IPC.AUTH_REQUIRED, listener);
    return () => ipcRenderer.removeListener(IPC.AUTH_REQUIRED, listener);
  },
  startOauth: (serverName: string) => ipcRenderer.invoke(IPC.START_OAUTH, serverName),
  dismissAuth: (serverName: string) => ipcRenderer.invoke(IPC.DISMISS_AUTH, serverName),
  skills: {
    list: () => ipcRenderer.invoke(IPC.LIST_SKILLS),
    get: (id: string) => ipcRenderer.invoke(IPC.GET_SKILL, id),
    save: (id: string, content: string) => ipcRenderer.invoke(IPC.SAVE_SKILL, id, content),
    delete: (id: string) => ipcRenderer.invoke(IPC.DELETE_SKILL, id)
  },
  plugins: {
    inspect: (source: string) => ipcRenderer.invoke(IPC.PLUGIN_INSPECT, source),
    install: (source: string, options?: unknown) => ipcRenderer.invoke(IPC.PLUGIN_INSTALL, source, options),
    prepare: (name: string) => ipcRenderer.invoke(IPC.PLUGIN_PREPARE, name),
    update: (name: string) => ipcRenderer.invoke(IPC.PLUGIN_UPDATE, name),
    uninstall: (name: string, options?: unknown) => ipcRenderer.invoke(IPC.PLUGIN_UNINSTALL, name, options),
    enable: (name: string) => ipcRenderer.invoke(IPC.PLUGIN_ENABLE, name),
    disable: (name: string) => ipcRenderer.invoke(IPC.PLUGIN_DISABLE, name),
    setProjectOverride: (name: string, projectPath: string, override: { enabled?: boolean; components?: Partial<Record<string, boolean>> }) =>
      ipcRenderer.invoke(IPC.PLUGIN_SET_PROJECT_OVERRIDE, name, projectPath, override),
    approve: (name: string, component: string) => ipcRenderer.invoke(IPC.PLUGIN_APPROVE, name, component),
    configSet: (name: string, key: string, value: string, options?: unknown) =>
      ipcRenderer.invoke(IPC.PLUGIN_CONFIG_SET, name, key, value, options),
    sync: (name?: string, options?: unknown) => ipcRenderer.invoke(IPC.PLUGIN_SYNC, name, options),
    status: (name?: string) => ipcRenderer.invoke(IPC.PLUGIN_STATUS, name),
    list: () => ipcRenderer.invoke(IPC.PLUGIN_LIST)
  },
  projectInit: (projectPath: string, name: string) => ipcRenderer.invoke(IPC.PROJECT_INIT, projectPath, name),
  projectRemove: (projectPath: string) => ipcRenderer.invoke(IPC.PROJECT_REMOVE, projectPath),
  setProjectServerEnabled: (projectPath: string, serverName: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC.PROJECT_SET_SERVER_ENABLED, projectPath, serverName, enabled),
  selectDirectory: () => ipcRenderer.invoke(IPC.SELECT_DIRECTORY) as Promise<string | null>,
  invoke: (channel: string, ...args: unknown[]) => {
    if (!ALLOWED_CHANNELS.has(channel)) {
      throw new Error(`Unknown IPC channel: ${channel}`);
    }
    return ipcRenderer.invoke(channel, ...args);
  }
};

contextBridge.exposeInMainWorld("mcpx", api);

export type McpxApi = typeof api;
