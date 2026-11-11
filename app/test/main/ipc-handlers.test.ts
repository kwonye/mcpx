// @vitest-environment node
/**
 * Behavioural tests for the IPC data plane (src/main/ipc-handlers.ts).
 *
 * Harness: every module ipc-handlers.ts imports is mocked with vi.doMock and
 * the module is imported fresh per test. ipcMain.handle is captured so
 * `invoke(channel, ...args)` calls a handler exactly like ipcRenderer.invoke.
 * mutateConfig runs its callback against `fakeConfig`, so assertions can check
 * that core mutators received the freshly loaded config (the concurrency fix).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC } from "../../src/shared/ipc-channels";
import { ipcSchemas } from "../../src/shared/ipc-schemas";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const handlers = new Map<string, Handler>();
const sent: Array<{ channel: string; payload: unknown }> = [];
let fakeConfig: Record<string, any>;

const syncSummary = { gatewayUrl: "", imports: {}, results: [], hasErrors: false };
const webContents = { send: vi.fn((channel: string, payload: unknown) => sent.push({ channel, payload })), isLoading: vi.fn(() => false), once: vi.fn() };
const dashboardWindow = { isDestroyed: () => false, webContents };

const core = {
  loadConfig: vi.fn(() => fakeConfig),
  mutateConfig: vi.fn(async (fn: (config: unknown) => unknown) => fn(fakeConfig)),
  loadMergedConfig: vi.fn(() => fakeConfig),
  registerProject: vi.fn(),
  unregisterProject: vi.fn(),
  setProjectServerEnabled: vi.fn(() => ({ effective: true, reason: undefined })),
  getDaemonStatus: vi.fn(() => ({ running: true, pid: 7, port: 37373, pidFile: "", logFile: "" })),
  startDaemon: vi.fn(async () => ({ started: true, pid: 7, port: 37373, message: "started" })),
  stopDaemonAsync: vi.fn(async () => ({ stopped: true, message: "stopped" })),
  restartDaemon: vi.fn(async () => ({ started: true, pid: 7, port: 37373, message: "restarted" })),
  synchronizeClients: vi.fn(async () => syncSummary),
  getSecretBackend: vi.fn(() => "file"),
  switchSecretBackend: vi.fn((backend: string) => ({ backend, changed: true, migrated: [], preserved: [] })),
  defaultAuthSecretName: vi.fn((server: string, target: { kind: string; key: string }) => `auth_${server}_${target.kind}_${target.key.toLowerCase()}`),
  controlRequest: vi.fn(async () => ({})),
  ensureControlService: vi.fn(async () => undefined),
  subscribeControlEvents: vi.fn(() => () => {}),
  addServer: vi.fn(),
  removeServer: vi.fn(),
  setServerEnabled: vi.fn(),
  updateServer: vi.fn(),
  listSkills: vi.fn(() => []),
  saveSkill: vi.fn(),
  deleteSkill: vi.fn(),
  installSkillFromSource: vi.fn(async () => ({ id: "s", content: "" })),
  customizeSkill: vi.fn(() => ({ id: "s", content: "" })),
  pinSkill: vi.fn(),
  unpinSkill: vi.fn(),
  updateSkill: vi.fn(async () => ({ id: "s", content: "" })),
  rollbackSkill: vi.fn(() => ({ id: "s", content: "" })),
  exportEnvironment: vi.fn(() => ({ environment: {}, lock: {} })),
  importEnvironment: vi.fn(async () => ({ importedSkills: [], importedPlugins: [], importedServers: [], missingInputs: [] })),
  SecretsManager: vi.fn(function SecretsManager(this: Record<string, unknown>) {
    this.setSecret = secretsSet;
    this.getSecret = vi.fn();
  }),
  buildStatusReport: vi.fn(async (_config: unknown, _index: unknown, daemon: { running: boolean }) => ({
    gatewayUrl: "", daemon, upstreamCount: 1, clients: {}, projects: {},
    servers: [{ name: "github", tokenCount: daemon.running ? { tools: 1, resources: 0, prompts: 0, total: 900 } : undefined }],
    totalGlobalTokens: daemon.running ? 900 : 0,
    totalProjectTokens: {}
  })),
  loadManagedIndex: vi.fn(() => ({})),
  probeHttpAuthRequirement: vi.fn(async () => ({ authRequired: false })),
  probeOAuthSupport: vi.fn(async () => ({ support: "supported" })),
  applyAuthReference: vi.fn(),
  resolveAuthTarget: vi.fn((_spec: unknown, header?: string, env?: string) => (env ? { kind: "env", key: env } : { kind: "header", key: header ?? "Authorization" })),
  toSecretRef: vi.fn((name: string) => `secret://${name}`),
  maybePrefixBearer: vi.fn((_target: unknown, value: string) => `Bearer ${value}`),
  parseCliAddCommand: vi.fn(() => ({ name: "notion", spec: { transport: "http", url: "https://mcp.notion.com/mcp" }, force: true })),
  tokenizeCommandLine: vi.fn((command: string) => command.split(/\s+/).filter(Boolean)),
  runOAuthLogin: vi.fn(async () => ({ serverName: "linear", authorized: true })),
  clearOAuthCredentials: vi.fn(),
  ensureGatewayToken: vi.fn(() => ""),
  getTelemetryStatus: vi.fn(() => ({ usageActive: false })),
  architecture: vi.fn(() => "arm64"),
  acknowledgeTelemetryNotice: vi.fn(() => ({ noticeAcknowledgedVersion: 1 })),
  updateTelemetryPreferences: vi.fn((patch: object) => patch),
  resetTelemetryInstallationId: vi.fn(() => ({})),
  initializeTelemetry: vi.fn(),
  shutdownTelemetry: vi.fn(async () => undefined),
  captureTelemetryEvent: vi.fn(),
  reportTelemetryError: vi.fn(),
  durationBucket: vi.fn(() => "lt_1s"),
  markTelemetryMilestone: vi.fn(),
  platformFamily: vi.fn(() => "macos"),
  listPlugins: vi.fn(async () => []),
  installPlugin: vi.fn(async () => ({ id: "p" })),
  updatePlugin: vi.fn(async () => ({ id: "p" })),
  pinPlugin: vi.fn(async () => undefined),
  unpinPlugin: vi.fn(async () => undefined),
  rollbackPlugin: vi.fn(async () => ({ id: "p" })),
  uninstallPlugin: vi.fn(async () => undefined),
  enablePlugin: vi.fn(async () => undefined),
  disablePlugin: vi.fn(async () => undefined),
  approvePluginComponent: vi.fn(async () => undefined),
  setPluginProjectOverride: vi.fn(async () => undefined),
  resetPluginProjectOverride: vi.fn(async () => undefined),
  listMarketplaces: vi.fn(async () => []),
  addMarketplace: vi.fn(async () => ({ name: "m" })),
  refreshMarketplaceWithPlugins: vi.fn(async () => ({ updated: [], errors: [] })),
  removeMarketplace: vi.fn(async () => undefined),
  setMarketplaceAutoUpdate: vi.fn(async () => ({})),
  listMarketplacePlugins: vi.fn(async () => []),
  inspectMarketplacePlugin: vi.fn(async () => ({})),
  installMarketplacePlugin: vi.fn(async () => ({ id: "p" }))
};
const secretsSet = vi.fn();

const authEvents = { queuePendingAuth: vi.fn(), dismissPendingAuth: vi.fn(), getPendingAuth: vi.fn(() => [] as Array<{ serverName: string }>) };
const openDashboard = vi.fn(() => dashboardWindow);
const updateTray = vi.fn();
const settingsStore = { loadDesktopSettings: vi.fn(() => ({ activeTab: "servers" })), updateDesktopSettings: vi.fn((patch: object) => ({ startOnLoginEnabled: true, autoUpdateEnabled: true, ...patch })) };
const loginItem = { applyStartOnLoginSetting: vi.fn() };
const updates = { checkForUpdatesNow: vi.fn(async () => ({ status: "up-to-date", message: "ok" })), setAutoUpdateEnabled: vi.fn() };
const shell = { openExternal: vi.fn(async () => undefined) };

async function load(options?: { controlService?: boolean }) {
  vi.resetModules();
  handlers.clear();
  vi.doMock("electron", () => ({
    app: { getAppPath: () => "/app", once: vi.fn() },
    ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
    dialog: { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ["/Users/ana/src/api"] })) },
    shell,
    BrowserWindow: { getAllWindows: () => [dashboardWindow] }
  }));
  vi.doMock("@mcpx/core", () => core);
  vi.doMock("../../src/main/dashboard", () => ({ openDashboard }));
  vi.doMock("../../src/main/settings-store", () => settingsStore);
  vi.doMock("../../src/main/login-item", () => loginItem);
  vi.doMock("../../src/main/update-manager", () => updates);
  vi.doMock("../../src/main/tray", () => ({ updateTrayForDaemonStatus: updateTray }));
  vi.doMock("../../src/main/auth-events", () => authEvents);
  vi.doMock("../../src/main/app-control", () => ({ quitApp: vi.fn() }));
  vi.doMock("../../src/main/cli-path", () => ({ resolveCliDaemonPath: () => "/cli/daemon.js" }));
  vi.doMock("../../src/main/error-reporting", () => ({ initializeDesktopErrorReporting: vi.fn(async () => undefined), refreshDesktopErrorReporting: vi.fn(async () => undefined) }));
  const module = await import("../../src/main/ipc-handlers");
  module.registerIpcHandlers(options);
  return module;
}

function invoke(channel: string, ...args: unknown[]) {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler for ${channel}`);
  return handler({}, ...args);
}

beforeEach(() => {
  vi.clearAllMocks();
  sent.length = 0;
  fakeConfig = { schemaVersion: 1, gateway: { port: 37373, autoStart: false }, servers: { github: { transport: "http", url: "https://x" }, local: { transport: "stdio", command: "npx" } }, clients: {} };
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
});

describe("registration", () => {
  it("registers a validated handler for every invoke channel and nothing else", async () => {
    await load();
    expect([...handlers.keys()].sort()).toEqual(Object.keys(ipcSchemas).sort());
    for (const channel of [IPC.NAVIGATE, IPC.AUTH_STATE_CHANGED, IPC.OAUTH_PROGRESS, IPC.TELEMETRY_CHANGED, IPC.MANAGEMENT_EVENT]) {
      expect(handlers.has(channel)).toBe(false);
    }
  });

  it("rejects malformed arguments with a readable message before touching core", async () => {
    await load();
    await expect(invoke(IPC.SET_SERVER_ENABLED, "github", "yes")).rejects.toThrow(/expected boolean/i);
    await expect(invoke(IPC.REMOVE_SERVER, "  ")).rejects.toThrow("Name must not be empty");
    await expect(invoke(IPC.ADD_SERVER, { name: "x", spec: { transport: "ftp" } })).rejects.toThrow();
    await expect(invoke(IPC.PLUGIN_APPROVE, "p", "everything")).rejects.toThrow();
    await expect(invoke(IPC.UPDATE_TELEMETRY_PREFERENCES, { usageAnalyticsEnabled: true, extra: 1 })).rejects.toThrow();
    expect(core.mutateConfig).not.toHaveBeenCalled();
  });

  it("reports validation failures to telemetry as validation_error", async () => {
    await load();
    await expect(invoke(IPC.ADD_SERVER, { name: "", spec: {} })).rejects.toThrow();
    expect(core.captureTelemetryEvent).toHaveBeenCalledWith(expect.objectContaining({
      properties: expect.objectContaining({ operation: "server_add", outcome: "failure", errorCode: "validation_error" })
    }));
  });
});

describe("status", () => {
  it("GET_STATUS never waits on token counting and reports the real daemon state", async () => {
    await load();
    const report = await invoke(IPC.GET_STATUS) as { daemon: { running: boolean }; totalGlobalTokens?: number };
    expect(core.buildStatusReport).toHaveBeenCalledWith(fakeConfig, {}, expect.objectContaining({ running: false }));
    expect(report.daemon.running).toBe(true);
    expect(report.totalGlobalTokens).toBeUndefined();
  });

  it("GET_TOKEN_COUNTS returns per-server counts and short-circuits when the gateway is stopped", async () => {
    await load();
    expect(await invoke(IPC.GET_TOKEN_COUNTS)).toEqual({ gatewayRunning: true, counts: { github: { tools: 1, resources: 0, prompts: 0, total: 900 } }, totalGlobalTokens: 900, totalProjectTokens: {} });
    core.getDaemonStatus.mockReturnValueOnce({ running: false, pid: 0, port: 0, pidFile: "", logFile: "" });
    expect(await invoke(IPC.GET_TOKEN_COUNTS)).toMatchObject({ gatewayRunning: false, counts: {} });
  });
});

describe("servers (in-process)", () => {
  it("parses URLs, launch commands and pasted add commands", async () => {
    await load();
    expect(await invoke(IPC.PARSE_SERVER_INPUT, "https://mcp.linear.app/mcp")).toEqual({ kind: "url", name: "linear", spec: { transport: "http", url: "https://mcp.linear.app/mcp" } });
    expect(await invoke(IPC.PARSE_SERVER_INPUT, "npx -y @modelcontextprotocol/server-filesystem ~/Docs")).toEqual({
      kind: "command", name: "filesystem", spec: { transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "~/Docs"] }
    });
    expect(await invoke(IPC.PARSE_SERVER_INPUT, "claude mcp add notion https://mcp.notion.com/mcp")).toMatchObject({ kind: "client-command", name: "notion", force: true });
    core.parseCliAddCommand.mockImplementationOnce(() => { throw new Error("missing url"); });
    await expect(invoke(IPC.PARSE_SERVER_INPUT, "codex mcp add")).rejects.toThrow("Couldn't read that command: missing url");
    await expect(invoke(IPC.PARSE_SERVER_INPUT, "ftp://x")).rejects.toThrow(/http/);
  });

  it("ADD_SERVER stores secrets, adds through mutateConfig, syncs and queues sign-in when the server asks", async () => {
    core.probeHttpAuthRequirement.mockResolvedValueOnce({ authRequired: true, status: 401, oauthLikely: true, oauthSupport: "supported" });
    await load();
    const spec = { transport: "http", url: "https://mcp.linear.app/mcp", headers: { "X-Key": "secret://auth_linear_header_x-key" } };
    const result = await invoke(IPC.ADD_SERVER, { name: "linear", spec, secrets: { "auth_linear_header_x-key": "k1", blank: "" } });
    expect(secretsSet).toHaveBeenCalledWith("auth_linear_header_x-key", "k1");
    expect(secretsSet).not.toHaveBeenCalledWith("blank", "");
    expect(core.addServer).toHaveBeenCalledWith(fakeConfig, "linear", spec, false);
    expect(core.synchronizeClients).toHaveBeenCalled();
    expect(authEvents.queuePendingAuth).toHaveBeenCalledWith({ serverName: "linear", oauthLikely: true, oauthSupport: "supported", status: 401 });
    expect(result).toMatchObject({ added: "linear", authRequired: true, oauthSupport: "supported" });
    expect(core.markTelemetryMilestone).toHaveBeenCalledWith("first_server_added");
  });

  it("UPDATE_SERVER keeps unchanged secrets (blank values are not written)", async () => {
    await load();
    await invoke(IPC.UPDATE_SERVER, "local", { transport: "stdio", command: "npx", env: { TOKEN: "secret://keep" } }, { keep: "" });
    expect(secretsSet).not.toHaveBeenCalled();
    expect(core.updateServer).toHaveBeenCalledWith(fakeConfig, "local", { transport: "stdio", command: "npx", env: { TOKEN: "secret://keep" } });
  });

  it("REMOVE_SERVER clears saved sign-ins and any pending reminder", async () => {
    await load();
    await invoke(IPC.REMOVE_SERVER, "github");
    expect(core.removeServer).toHaveBeenCalledWith(fakeConfig, "github", false);
    expect(core.clearOAuthCredentials).toHaveBeenCalledWith("github", expect.anything());
    expect(authEvents.dismissPendingAuth).toHaveBeenCalledWith("github");
  });

  it("SET_SERVER_ENABLED and project toggles go through mutateConfig then sync", async () => {
    await load();
    await invoke(IPC.SET_SERVER_ENABLED, "github", false);
    expect(core.setServerEnabled).toHaveBeenCalledWith(fakeConfig, "github", false);
    const toggled = await invoke(IPC.PROJECT_SET_SERVER_ENABLED, "/p", "github", true);
    expect(core.setProjectServerEnabled).toHaveBeenCalledWith(fakeConfig, "/p", "github", true);
    expect(toggled).toMatchObject({ effective: true, projectPath: "/p" });
    expect(core.synchronizeClients).toHaveBeenCalledTimes(2);
  });
});

describe("auth", () => {
  it("CONFIGURE_AUTH writes a header token and dismisses the reminder", async () => {
    await load();
    await invoke(IPC.CONFIGURE_AUTH, { serverName: "github", headerName: "Authorization", authValue: "tok" });
    expect(core.resolveAuthTarget).toHaveBeenCalledWith(fakeConfig.servers.github, "Authorization", undefined);
    expect(secretsSet).toHaveBeenCalledWith("auth_github_header_authorization", "Bearer tok");
    expect(core.applyAuthReference).toHaveBeenCalledWith(fakeConfig.servers.github, { kind: "header", key: "Authorization" }, "secret://auth_github_header_authorization");
    expect(authEvents.dismissPendingAuth).toHaveBeenCalledWith("github");
  });

  it("CONFIGURE_AUTH supports environment variables for local servers", async () => {
    await load();
    await invoke(IPC.CONFIGURE_AUTH, { serverName: "local", envName: "GITHUB_TOKEN", authValue: "ghp" });
    expect(core.resolveAuthTarget).toHaveBeenCalledWith(fakeConfig.servers.local, undefined, "GITHUB_TOKEN");
    await expect(invoke(IPC.CONFIGURE_AUTH, { serverName: "local", envName: "1BAD", authValue: "x" })).rejects.toThrow(/variable name/);
  });

  it("REQUEST_AUTH queues the reminder and opens the dashboard at the sign-in intent", async () => {
    await load();
    await invoke(IPC.REQUEST_AUTH, "github");
    expect(authEvents.queuePendingAuth).toHaveBeenCalledWith({ serverName: "github" });
    expect(sent).toContainEqual({ channel: IPC.NAVIGATE, payload: "servers:auth:github" });
    await expect(invoke(IPC.REQUEST_AUTH, "missing")).rejects.toThrow('Server "missing" not found.');
  });

  it("START_OAUTH joins an in-flight login, broadcasts progress, and CANCEL_OAUTH aborts it", async () => {
    let finish: () => void = () => {};
    core.runOAuthLogin.mockImplementationOnce((_name, _spec, _secrets, openUrl, _a, _b, options: { onProgress: (event: unknown) => void; signal: AbortSignal }) => {
      openUrl("https://auth.example/authorize");
      options.onProgress({ phase: "awaiting-browser", authorizationUrl: "https://auth.example/authorize", expiresAt: 1 });
      return new Promise((resolve) => { finish = () => resolve({ serverName: "github", authorized: true }); });
    });
    await load();
    const first = invoke(IPC.START_OAUTH, "github");
    const second = invoke(IPC.START_OAUTH, "github");
    expect(core.runOAuthLogin).toHaveBeenCalledTimes(1);
    expect(sent).toContainEqual({ channel: IPC.OAUTH_PROGRESS, payload: expect.objectContaining({ serverName: "github", phase: "awaiting-browser" }) });
    expect(await invoke(IPC.OAUTH_REOPEN, "github")).toEqual({ reopened: true });
    expect(await invoke(IPC.CANCEL_OAUTH, "github")).toEqual({ cancelled: true });
    finish();
    await expect(first).resolves.toEqual({ serverName: "github", authorized: true });
    await expect(second).resolves.toEqual({ serverName: "github", authorized: true });
    expect(sent).toContainEqual({ channel: IPC.OAUTH_PROGRESS, payload: { serverName: "github", phase: "done" } });
  });

  it("refuses browser sign-in for local commands", async () => {
    await load();
    await expect(invoke(IPC.START_OAUTH, "local")).rejects.toThrow(/only available for URL-based servers/);
  });
});

describe("management service routing", () => {
  it("routes mutations through the control service with mapped arguments", async () => {
    core.controlRequest.mockResolvedValueOnce({ added: "linear", authRequired: true, oauthSupport: "supported", authStatus: 401, sync: syncSummary });
    await load({ controlService: true });
    const spec = { transport: "http", url: "https://mcp.linear.app/mcp" };
    await invoke(IPC.ADD_SERVER, { name: "linear", spec, secrets: { a: "b" }, force: true });
    expect(core.ensureControlService).toHaveBeenCalledWith("/cli/daemon.js");
    expect(core.controlRequest).toHaveBeenCalledWith("server.add", ["linear", spec, { a: "b" }]);
    expect(core.addServer).not.toHaveBeenCalled();
    expect(authEvents.queuePendingAuth).toHaveBeenCalledWith(expect.objectContaining({ serverName: "linear", oauthSupport: "supported" }));

    await invoke(IPC.PLUGIN_UNINSTALL, "p", true);
    expect(core.controlRequest).toHaveBeenLastCalledWith("plugin.uninstall", ["p", { keepData: true }]);
    await invoke(IPC.MARKETPLACE_ADD, "acme/x", "m.json");
    expect(core.controlRequest).toHaveBeenLastCalledWith("marketplace.add", ["acme/x", "m.json"]);
    await invoke(IPC.CONFIGURE_AUTH, { serverName: "github", headerName: "Authorization", authValue: "t" });
    expect(core.controlRequest).toHaveBeenLastCalledWith("auth.configure", [{ serverName: "github", headerName: "Authorization", authValue: "t" }]);
    expect(authEvents.dismissPendingAuth).toHaveBeenCalledWith("github");
  });

  it("keeps reads in-process and wraps browser sign-in in a writer lease", async () => {
    core.controlRequest.mockImplementation(async (method: string) => (method === "lease.acquire" ? "lease-1" : {}));
    await load({ controlService: true });
    await invoke(IPC.LIST_SKILLS);
    expect(core.listSkills).toHaveBeenCalled();
    await invoke(IPC.START_OAUTH, "github");
    expect(core.controlRequest).toHaveBeenCalledWith("lease.acquire", [process.pid, "OAuth login"]);
    expect(core.controlRequest).toHaveBeenCalledWith("lease.release", ["lease-1", true]);
    core.controlRequest.mockReset();
  });

  it("exposes management snapshot, adoption, rollback and harness modes", async () => {
    await load();
    await invoke(IPC.MANAGEMENT_SNAPSHOT);
    expect(core.ensureControlService).not.toHaveBeenCalled();
    expect(core.controlRequest).toHaveBeenLastCalledWith("snapshot", []);
    await invoke(IPC.ADOPTION_PLAN, ["cursor:global"]);
    expect(core.controlRequest).toHaveBeenLastCalledWith("adoption.plan", [["cursor:global"]]);
    const plan = { id: "p", createdAt: "", configHash: "", items: [], errors: [] };
    await invoke(IPC.ADOPTION_APPLY, plan, ["a"]);
    expect(core.controlRequest).toHaveBeenLastCalledWith("adoption.apply", [plan, ["a"]]);
    await invoke(IPC.OPERATION_ROLLBACK, "op");
    expect(core.controlRequest).toHaveBeenLastCalledWith("operation.rollback", ["op"]);
    await invoke(IPC.HARNESS_SET_MODE, "cursor:global", "observe");
    expect(core.controlRequest).toHaveBeenLastCalledWith("harness.mode", ["cursor:global", "observe"]);
    await expect(invoke(IPC.HARNESS_SET_MODE, "cursor:global", "everything")).rejects.toThrow();
  });

  it("subscribes to management events and rebroadcasts them", async () => {
    let listener: (event: unknown) => void = () => {};
    core.subscribeControlEvents.mockImplementationOnce((callback: (event: unknown) => void) => {
      listener = callback;
      return () => {};
    });
    await load({ controlService: true });
    await vi.waitFor(() => expect(core.subscribeControlEvents).toHaveBeenCalled());
    listener({ type: "operation" });
    expect(sent).toContainEqual({ channel: IPC.MANAGEMENT_EVENT, payload: { type: "operation" } });
  });
});

describe("app, settings and secrets", () => {
  it("OPEN_DASHBOARD forwards a route to the dashboard once it has loaded", async () => {
    await load();
    webContents.isLoading.mockReturnValueOnce(true);
    await invoke(IPC.OPEN_DASHBOARD, { route: "servers:add" });
    expect(webContents.once).toHaveBeenCalledWith("did-finish-load", expect.any(Function));
    (webContents.once.mock.calls[0][1] as () => void)();
    expect(sent).toContainEqual({ channel: IPC.NAVIGATE, payload: "servers:add" });
  });

  it("applies login-item and auto-update side effects only for changed keys", async () => {
    await load();
    await invoke(IPC.UPDATE_DESKTOP_SETTINGS, { startOnLoginEnabled: false });
    expect(loginItem.applyStartOnLoginSetting).toHaveBeenCalledWith(false);
    expect(updates.setAutoUpdateEnabled).not.toHaveBeenCalled();
  });

  it("switches the secrets backend", async () => {
    await load();
    expect(await invoke(IPC.GET_SECRET_BACKEND)).toBe("file");
    await invoke(IPC.SET_SECRET_BACKEND, "keychain");
    expect(core.switchSecretBackend).toHaveBeenCalledWith("keychain");
    await expect(invoke(IPC.SET_SECRET_BACKEND, "vault")).rejects.toThrow();
  });

  it("acknowledging the privacy notice starts telemetry and broadcasts the new status", async () => {
    await load();
    await invoke(IPC.ACKNOWLEDGE_TELEMETRY_NOTICE);
    expect(core.acknowledgeTelemetryNotice).toHaveBeenCalled();
    expect(core.initializeTelemetry).toHaveBeenCalled();
    expect(sent.some((entry) => entry.channel === IPC.TELEMETRY_CHANGED)).toBe(true);
  });

  it("only reports tab views the telemetry schema knows", async () => {
    await load();
    await invoke(IPC.CAPTURE_DESKTOP_TAB_VIEWED, "plugins");
    expect(core.captureTelemetryEvent).toHaveBeenCalledWith({ name: "desktop_tab_viewed", properties: { tab: "plugins" } });
    await expect(invoke(IPC.CAPTURE_DESKTOP_TAB_VIEWED, "clients")).rejects.toThrow();
  });

  it("starting the gateway updates the tray and surfaces failures", async () => {
    await load();
    await invoke(IPC.DAEMON_START);
    expect(updateTray).toHaveBeenCalledWith(true);
    core.startDaemon.mockResolvedValueOnce({ started: false, pid: 0, port: 0, message: "port in use" });
    await expect(invoke(IPC.DAEMON_START)).rejects.toThrow("port in use");
  });
});
