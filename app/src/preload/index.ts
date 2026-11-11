// Sandbox-safe preload: only `electron` is imported at runtime; everything
// else is type-only or a plain constant object bundled into this file.
import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { TelemetryStatus } from "@mcpx/core";
import { IPC } from "../shared/ipc-channels";
import type { InvokeChannel, IpcArgs, IpcResult, OAuthProgressPayload, PendingAuthEntry } from "../shared/ipc-contract";

const REMOTE_ERROR_PREFIX = /^Error invoking remote method '[^']+':\s*(?:\w*Error:\s*)?/;

function call<C extends InvokeChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>> {
  return ipcRenderer.invoke(channel, ...args).catch((error: unknown) => {
    if (error instanceof Error) {
      error.message = error.message.replace(REMOTE_ERROR_PREFIX, "");
    }
    throw error;
  }) as Promise<IpcResult<C>>;
}

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

// Main may send "navigate" on did-finish-load, before React subscribes, so
// listen from preload load time and replay the last route to late subscribers.
let lastRoute: string | null = null;
const navigateListeners = new Set<(route: string) => void>();
ipcRenderer.on(IPC.NAVIGATE, (_event: IpcRendererEvent, route: unknown) => {
  if (typeof route !== "string") return;
  if (navigateListeners.size === 0) {
    lastRoute = route;
    return;
  }
  for (const listener of navigateListeners) listener(route);
});

function onNavigate(callback: (route: string) => void): () => void {
  navigateListeners.add(callback);
  if (lastRoute !== null) {
    const route = lastRoute;
    lastRoute = null;
    callback(route);
  }
  return () => {
    navigateListeners.delete(callback);
  };
}

/** Binds a channel to a typed function: `bind(IPC.X)(...args)`. */
const bind = <C extends InvokeChannel>(channel: C) => (...args: IpcArgs<C>) => call(channel, ...args);

const api = {
  platform: process.platform as "darwin" | "win32" | "linux" | (string & {}),

  app: {
    openDashboard: bind(IPC.OPEN_DASHBOARD),
    quit: bind(IPC.QUIT_APP),
    /** Main asks the dashboard to show a route ("servers", "clients", ...). */
    onNavigate,
    selectDirectory: bind(IPC.SELECT_DIRECTORY),
    checkForUpdates: bind(IPC.CHECK_FOR_UPDATES)
  },

  status: {
    get: bind(IPC.GET_STATUS),
    tokenCounts: bind(IPC.GET_TOKEN_COUNTS),
    syncAll: bind(IPC.SYNC_ALL)
  },

  gateway: {
    start: bind(IPC.DAEMON_START),
    stop: bind(IPC.DAEMON_STOP),
    restart: bind(IPC.DAEMON_RESTART)
  },

  management: {
    snapshot: bind(IPC.MANAGEMENT_SNAPSHOT),
    planAdoption: bind(IPC.ADOPTION_PLAN),
    applyAdoption: bind(IPC.ADOPTION_APPLY),
    rollback: bind(IPC.OPERATION_ROLLBACK),
    setHarnessMode: bind(IPC.HARNESS_SET_MODE),
    onChange: (callback: () => void) => subscribe<unknown>(IPC.MANAGEMENT_EVENT, () => callback())
  },

  secrets: {
    backend: bind(IPC.GET_SECRET_BACKEND),
    setBackend: bind(IPC.SET_SECRET_BACKEND)
  },

  settings: {
    get: bind(IPC.GET_DESKTOP_SETTINGS),
    update: bind(IPC.UPDATE_DESKTOP_SETTINGS)
  },

  telemetry: {
    status: bind(IPC.GET_TELEMETRY_STATUS),
    acknowledge: bind(IPC.ACKNOWLEDGE_TELEMETRY_NOTICE),
    updatePreferences: bind(IPC.UPDATE_TELEMETRY_PREFERENCES),
    resetId: bind(IPC.RESET_TELEMETRY_ID),
    captureTabViewed: bind(IPC.CAPTURE_DESKTOP_TAB_VIEWED),
    onChanged: (callback: (status: TelemetryStatus) => void) => subscribe<TelemetryStatus>(IPC.TELEMETRY_CHANGED, callback)
  },

  servers: {
    parseInput: bind(IPC.PARSE_SERVER_INPUT),
    add: bind(IPC.ADD_SERVER),
    update: bind(IPC.UPDATE_SERVER),
    remove: bind(IPC.REMOVE_SERVER),
    setEnabled: bind(IPC.SET_SERVER_ENABLED)
  },

  auth: {
    configure: bind(IPC.CONFIGURE_AUTH),
    pending: bind(IPC.GET_PENDING_AUTH),
    onPendingChanged: (callback: (entries: PendingAuthEntry[]) => void) => subscribe<PendingAuthEntry[]>(IPC.AUTH_STATE_CHANGED, callback),
    request: bind(IPC.REQUEST_AUTH),
    dismiss: bind(IPC.DISMISS_AUTH),
    checkOAuthSupport: bind(IPC.CHECK_OAUTH_SUPPORT),
    startOAuth: bind(IPC.START_OAUTH),
    cancelOAuth: bind(IPC.CANCEL_OAUTH),
    reopenOAuth: bind(IPC.OAUTH_REOPEN),
    onOAuthProgress: (callback: (event: OAuthProgressPayload) => void) => subscribe<OAuthProgressPayload>(IPC.OAUTH_PROGRESS, callback)
  },

  projects: {
    add: bind(IPC.PROJECT_INIT),
    remove: bind(IPC.PROJECT_REMOVE),
    setServerEnabled: bind(IPC.PROJECT_SET_SERVER_ENABLED)
  },

  skills: {
    list: bind(IPC.LIST_SKILLS),
    save: bind(IPC.SAVE_SKILL),
    delete: bind(IPC.DELETE_SKILL),
    install: bind(IPC.INSTALL_SKILL),
    customize: bind(IPC.CUSTOMIZE_SKILL),
    pin: bind(IPC.PIN_SKILL),
    unpin: bind(IPC.UNPIN_SKILL),
    update: bind(IPC.UPDATE_SKILL),
    rollback: bind(IPC.ROLLBACK_SKILL)
  },

  share: {
    export: bind(IPC.SHARE_EXPORT),
    import: bind(IPC.SHARE_IMPORT)
  },

  plugins: {
    list: bind(IPC.PLUGIN_LIST),
    install: bind(IPC.PLUGIN_INSTALL),
    update: bind(IPC.PLUGIN_UPDATE),
    pin: bind(IPC.PLUGIN_PIN),
    unpin: bind(IPC.PLUGIN_UNPIN),
    rollback: bind(IPC.PLUGIN_ROLLBACK),
    uninstall: bind(IPC.PLUGIN_UNINSTALL),
    enable: bind(IPC.PLUGIN_ENABLE),
    disable: bind(IPC.PLUGIN_DISABLE),
    approve: bind(IPC.PLUGIN_APPROVE),
    setProjectOverride: bind(IPC.PLUGIN_SET_PROJECT_OVERRIDE),
    resetProjectOverride: bind(IPC.PLUGIN_RESET_PROJECT_OVERRIDE)
  },

  marketplaces: {
    list: bind(IPC.MARKETPLACE_LIST),
    add: bind(IPC.MARKETPLACE_ADD),
    refresh: bind(IPC.MARKETPLACE_REFRESH),
    remove: bind(IPC.MARKETPLACE_REMOVE),
    setAutoUpdate: bind(IPC.MARKETPLACE_SET_AUTO_UPDATE),
    browse: bind(IPC.MARKETPLACE_BROWSE),
    inspect: bind(IPC.MARKETPLACE_INSPECT_PLUGIN),
    install: bind(IPC.MARKETPLACE_INSTALL_PLUGIN)
  }
};

contextBridge.exposeInMainWorld("mcpx", api);

export type McpxApi = typeof api;
