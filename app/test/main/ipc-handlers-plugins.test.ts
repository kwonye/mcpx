// @vitest-environment node
/**
 * ============================================================================
 * HARNESS CONTRACT - read this before copying this file for another channel
 * group (ipc-handlers-<group>.test.ts). This file is the template.
 * ============================================================================
 *
 * WHAT'S MOCKED AND WHY
 *
 * - "electron": ipc-handlers.ts imports { app, ipcMain, dialog, shell } at the
 *   top of the file, so all four must exist on the mock even if your group
 *   only touches one of them.
 *
 * - Every sibling module ipc-handlers.ts imports from src/main/ (dashboard,
 *   settings-store, login-item, update-manager, tray, auth-events,
 *   app-control) is mocked wholesale with vi.doMock, even the ones this
 *   file's tests never invoke. registerIpcHandlers() is one function that
 *   registers ALL ~40 channels, so importing the module at all requires every
 *   one of its static imports to resolve - skip one and every group's test
 *   file breaks at import time, not just the group that needed it. Several of
 *   these siblings (e.g. auth-events.ts) import `electron` themselves; mocking
 *   the sibling wholesale means its real body (and its own electron import)
 *   never executes, so we don't need to reverse-engineer what it needs from
 *   `electron` - only what ipc-handlers.ts itself imports directly.
 *
 * - "@mcpx/core": ipc-handlers.ts destructures ~34 names from one `import {
 *   ... } from "@mcpx/core"` statement. Every one of those names must exist
 *   on the mock (as a vi.fn(), or a class for SecretsManager/PluginManager),
 *   or a handler that touches it throws "X is not a function" the moment
 *   it's invoked - even for names your group doesn't care about. If
 *   ipc-handlers.ts's import list changes, update the object below to match.
 *
 * - mutateConfig is special. Production signature is roughly
 *   `mutateConfig<T>(fn: (config) => T | Promise<T>): Promise<T>` - it loads
 *   a FRESH config from disk under a lock, runs the callback against it, and
 *   saves the result back (see cli/src/core/config-store.ts). Handlers were
 *   recently changed to route every config mutation through it instead of a
 *   stale in-memory object (see "Fix concurrency data loss" in git log). The
 *   mock below reproduces just enough of the contract - it invokes
 *   `fn(fakeConfig)` and returns/awaits the result - so the handler's inline
 *   callback (e.g. `(config) => addServer(config, name, spec, true)`) really
 *   executes against an object during the test, instead of silently no-oping.
 *   For every mutating handler, assert BOTH that `mutateConfigMock` was
 *   called AND that the wrapped core fn received `fakeConfig` as its first
 *   arg - that pair is the regression guard for the concurrency fix. If a
 *   future change reverts to mutating some handler-local config instead of
 *   going through mutateConfig, the second assertion catches it even though
 *   the first still passes.
 *
 * - ipcMain.handle(channel, handler) is captured into `registeredHandlers`
 *   (a Map) instead of wiring up real IPC. `invokeHandler(channel, ...args)`
 *   looks the handler up and calls it with a fake event object, exactly like
 *   the renderer would via `ipcRenderer.invoke(channel, ...args)`.
 *
 * ORDERING RULES (see beforeEach below)
 *
 * 1. vi.resetModules() + vi.clearAllMocks() first, so every test starts from
 *    a blank module cache and blank mock call history.
 * 2. Re-establish default mock return values/implementations.
 * 3. vi.doMock(...) every module ipc-handlers.ts touches, directly or
 *    transitively through its own static imports.
 * 4. Dynamically `await import("../../src/main/ipc-handlers")` and call
 *    registerIpcHandlers(). This MUST happen after steps 1-3, or Node hands
 *    back a stale/unmocked module from its cache. vi.doMock (unlike the
 *    hoisted vi.mock) is not hoisted, so it's safe to declare it inside
 *    beforeEach, after the mock vi.fn()s it closes over.
 *
 * TO COPY FOR ANOTHER GROUP
 *
 * 1. Duplicate this file as ipc-handlers-<group>.test.ts.
 * 2. Keep the electron mock, the sibling-module mocks, and the full
 *    @mcpx/core mock object as-is - completeness has to live in every file
 *    since each test file imports the module fresh.
 * 3. Promote any inline `vi.fn()` in the @mcpx/core mock to a named const
 *    (as done for e.g. addServerMock) if your group needs to configure or
 *    assert on it.
 * 4. Replace the per-channel `describe(...)` blocks at the bottom with your
 *    group's channels.
 * ============================================================================
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC } from "../../src/shared/ipc-channels";

type IpcHandler = (event: unknown, ...args: any[]) => unknown;

function makeConfig(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    schemaVersion: 1,
    gateway: { port: 37373, tokenRef: "secret://local_gateway_token", autoStart: true },
    servers: {},
    clients: {},
    ...overrides
  };
}

function makeSyncSummary(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    gatewayUrl: "http://127.0.0.1:37373/mcp",
    imports: { imported: [], duplicates: [], skipped: [], conflicts: [], errors: [] },
    results: [],
    hasErrors: false,
    ...overrides
  };
}

describe("ipc-handlers.ts - plugins group", () => {
  // ---- ipcMain.handle capture -----------------------------------------------
  const registeredHandlers = new Map<string, IpcHandler>();
  const ipcMainHandleMock = vi.fn((channel: string, handler: IpcHandler) => {
    registeredHandlers.set(channel, handler);
  });

  async function invokeHandler(channel: string, ...args: unknown[]): Promise<unknown> {
    const handler = registeredHandlers.get(channel);
    if (!handler) {
      throw new Error(`No handler registered for "${channel}" - did registerIpcHandlers() run in beforeEach?`);
    }
    return handler({}, ...args);
  }

  // ---- @mcpx/core mocks referenced directly by tests in this group ----------
  // (Names not listed here are stubbed inline in the vi.doMock("@mcpx/core", ...)
  // factory below - promote to a named const here if a test needs to
  // configure or assert on one.)
  const inspectPluginMock = vi.fn();
  const installPluginMock = vi.fn();
  const preparePluginMock = vi.fn();
  const updatePluginMock = vi.fn();
  const uninstallPluginMock = vi.fn();
  const enablePluginMock = vi.fn();
  const disablePluginMock = vi.fn();
  const setPluginProjectOverrideMock = vi.fn();
  const resetPluginProjectOverrideMock = vi.fn();
  const approvePluginComponentMock = vi.fn();
  const getPluginStatusMock = vi.fn();
  const listPluginsMock = vi.fn();
  const pluginConfigSetMock = vi.fn();
  const pluginSyncMock = vi.fn();
  const listMarketplacesMock = vi.fn();
  const addMarketplaceMock = vi.fn();
  const refreshMarketplaceWithPluginsMock = vi.fn();
  const removeMarketplaceMock = vi.fn();
  const setMarketplaceAutoUpdateMock = vi.fn();
  const listMarketplacePluginsMock = vi.fn();
  const inspectMarketplacePluginMock = vi.fn();
  const installMarketplacePluginMock = vi.fn();

  let fakeConfig: Record<string, any>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    registeredHandlers.clear();

    fakeConfig = makeConfig();

    // ---- sensible defaults; individual tests override via mockReturnValue/
    // mockImplementation *after* this hook runs, before calling invokeHandler.
    inspectPluginMock.mockResolvedValue({ name: "stub-plugin", version: "1.0.0" });
    installPluginMock.mockResolvedValue({ name: "stub-plugin", installed: true });
    preparePluginMock.mockResolvedValue(undefined);
    updatePluginMock.mockResolvedValue({ name: "stub-plugin", updated: true });
    uninstallPluginMock.mockResolvedValue(undefined);
    enablePluginMock.mockResolvedValue(undefined);
    disablePluginMock.mockResolvedValue(undefined);
    setPluginProjectOverrideMock.mockResolvedValue(undefined);
    resetPluginProjectOverrideMock.mockResolvedValue(undefined);
    approvePluginComponentMock.mockResolvedValue(undefined);
    getPluginStatusMock.mockResolvedValue({ name: "stub-plugin", enabled: true });
    listPluginsMock.mockResolvedValue([
      { name: "plugin1", enabled: true },
      { name: "plugin2", enabled: false }
    ]);
    pluginConfigSetMock.mockResolvedValue(undefined);
    pluginSyncMock.mockResolvedValue(undefined);
    listMarketplacesMock.mockResolvedValue([]);
    addMarketplaceMock.mockResolvedValue({ name: "team-tools" });
    refreshMarketplaceWithPluginsMock.mockResolvedValue({ updated: [], errors: [] });
    removeMarketplaceMock.mockResolvedValue(undefined);
    setMarketplaceAutoUpdateMock.mockResolvedValue({ name: "team-tools", autoUpdate: true });
    listMarketplacePluginsMock.mockResolvedValue([]);
    inspectMarketplacePluginMock.mockResolvedValue({ id: "reviewer@team-tools" });
    installMarketplacePluginMock.mockResolvedValue({ id: "reviewer@abc123" });

    vi.doMock("electron", () => ({
      app: { getAppPath: vi.fn(() => "/fake/app-path") },
      ipcMain: { handle: ipcMainHandleMock },
      dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
      shell: { openExternal: vi.fn(async () => undefined) }
    }));

    vi.doMock("../../src/main/dashboard", () => ({
      openDashboard: vi.fn()
    }));
    vi.doMock("../../src/main/settings-store", () => ({
      loadDesktopSettings: vi.fn(() => ({})),
      updateDesktopSettings: vi.fn((patch: unknown) => patch)
    }));
    vi.doMock("../../src/main/login-item", () => ({
      applyStartOnLoginSetting: vi.fn()
    }));
    vi.doMock("../../src/main/update-manager", () => ({
      checkForUpdatesNow: vi.fn(async () => ({})),
      setAutoUpdateEnabled: vi.fn()
    }));
    vi.doMock("../../src/main/tray", () => ({
      updateTrayForDaemonStatus: vi.fn()
    }));
    vi.doMock("../../src/main/auth-events", () => ({
      dismissPendingAuth: vi.fn(),
      getPendingAuth: vi.fn(() => []),
      queuePendingAuth: vi.fn()
    }));
    vi.doMock("../../src/main/app-control", () => ({
      quitApp: vi.fn()
    }));

    // Full named-export list copied from ipc-handlers.ts's
    // `import { ... } from "@mcpx/core"` block - keep in sync with that file.
    vi.doMock("@mcpx/core", () => ({
      loadConfig: vi.fn(() => fakeConfig),
      mutateConfig: vi.fn(),
      loadMergedConfig: vi.fn(() => fakeConfig),
      registerProject: vi.fn(),
      unregisterProject: vi.fn(),
      setProjectServerEnabled: vi.fn(() => ({ effective: true })),
      getDaemonStatus: vi.fn(() => ({ running: false })),
      startDaemon: vi.fn(async () => ({ started: true })),
      stopDaemon: vi.fn(() => ({ started: false })),
      restartDaemon: vi.fn(async () => ({ started: true })),
      syncAllClients: vi.fn(async () => makeSyncSummary()),
      persistSyncState: vi.fn(),
      addServer: vi.fn(),
      removeServer: vi.fn(),
      setServerEnabled: vi.fn(),
      updateServer: vi.fn(),
      listAuthBindings: vi.fn(() => []),
      listSkills: vi.fn(() => []),
      getSkill: vi.fn(() => null),
      saveSkill: vi.fn(),
      deleteSkill: vi.fn(),
      SecretsManager: vi.fn(),
      buildStatusReport: vi.fn(async () => ({})),
      loadManagedIndex: vi.fn(() => ({ schemaVersion: 1, managed: {} })),
      probeHttpAuthRequirement: vi.fn(async () => ({ authRequired: false })),
      applyAuthReference: vi.fn(),
      resolveAuthTarget: vi.fn(() => ({ kind: "header", key: "Authorization" })),
      toSecretRef: vi.fn((name: string) => `secret://${name}`),
      maybePrefixBearer: vi.fn((_target: unknown, value: string) => value),
      parseCliAddCommand: vi.fn(),
      tokenizeCommandLine: vi.fn((command: string) => [command]),
      runOAuthLogin: vi.fn(async () => ({ success: true })),
      PluginManager: vi.fn(),
      ensureGatewayToken: vi.fn(),
      // Plugin-specific exports (all are lazy-imported in handlers)
      inspectPlugin: inspectPluginMock,
      installPlugin: installPluginMock,
      preparePlugin: preparePluginMock,
      updatePlugin: updatePluginMock,
      uninstallPlugin: uninstallPluginMock,
      enablePlugin: enablePluginMock,
      disablePlugin: disablePluginMock,
      setPluginProjectOverride: setPluginProjectOverrideMock,
      resetPluginProjectOverride: resetPluginProjectOverrideMock,
      approvePluginComponent: approvePluginComponentMock,
      getPluginStatus: getPluginStatusMock,
      listPlugins: listPluginsMock,
      pluginConfigSet: pluginConfigSetMock,
      pluginSync: pluginSyncMock,
      listMarketplaces: listMarketplacesMock,
      addMarketplace: addMarketplaceMock,
      refreshMarketplaceWithPlugins: refreshMarketplaceWithPluginsMock,
      removeMarketplace: removeMarketplaceMock,
      setMarketplaceAutoUpdate: setMarketplaceAutoUpdateMock,
      listMarketplacePlugins: listMarketplacePluginsMock,
      inspectMarketplacePlugin: inspectMarketplacePluginMock,
      installMarketplacePlugin: installMarketplacePluginMock
    }));

    const { registerIpcHandlers } = await import("../../src/main/ipc-handlers");
    registerIpcHandlers();
  });

  // ---------------------------------------------------------------------------
  describe("PLUGIN_INSPECT", () => {
    it("calls inspectPlugin with source and returns the result", async () => {
      const mockResult = { name: "my-plugin", version: "2.0.0", description: "A test plugin" };
      inspectPluginMock.mockResolvedValue(mockResult);

      const result = await invokeHandler(IPC.PLUGIN_INSPECT, "https://github.com/example/plugin");

      expect(inspectPluginMock).toHaveBeenCalledWith("https://github.com/example/plugin");
      expect(result).toEqual(mockResult);
    });

    it("propagates errors from inspectPlugin", async () => {
      inspectPluginMock.mockRejectedValue(new Error("invalid source URL"));

      await expect(invokeHandler(IPC.PLUGIN_INSPECT, "bad-source")).rejects.toThrow("invalid source URL");
    });
  });

  // ---------------------------------------------------------------------------
  describe("PLUGIN_INSTALL", () => {
    it("calls installPlugin with source and options, returns the result", async () => {
      const mockResult = { name: "installed-plugin", installed: true, version: "1.5.0" };
      installPluginMock.mockResolvedValue(mockResult);
      const options = { force: true };

      const result = await invokeHandler(IPC.PLUGIN_INSTALL, "https://example.com/plugin.zip", options);

      expect(installPluginMock).toHaveBeenCalledWith("https://example.com/plugin.zip", options);
      expect(result).toEqual(mockResult);
    });

    it("propagates errors from installPlugin", async () => {
      installPluginMock.mockRejectedValue(new Error("download failed"));

      await expect(invokeHandler(IPC.PLUGIN_INSTALL, "https://broken.com/plugin")).rejects.toThrow("download failed");
    });
  });

  // ---------------------------------------------------------------------------
  describe("PLUGIN_PREPARE", () => {
    it("calls preparePlugin with name and returns success shape", async () => {
      const result = await invokeHandler(IPC.PLUGIN_PREPARE, "my-plugin");

      expect(preparePluginMock).toHaveBeenCalledWith("my-plugin");
      expect(result).toEqual({ name: "my-plugin", success: true });
    });

    it("propagates errors from preparePlugin", async () => {
      preparePluginMock.mockRejectedValue(new Error("plugin not found"));

      await expect(invokeHandler(IPC.PLUGIN_PREPARE, "nonexistent")).rejects.toThrow("plugin not found");
    });
  });

  // ---------------------------------------------------------------------------
  describe("PLUGIN_UPDATE", () => {
    it("calls updatePlugin with name and returns the result", async () => {
      const mockResult = { name: "my-plugin", updated: true, previousVersion: "1.0.0", newVersion: "1.1.0" };
      updatePluginMock.mockResolvedValue(mockResult);

      const result = await invokeHandler(IPC.PLUGIN_UPDATE, "my-plugin");

      expect(updatePluginMock).toHaveBeenCalledWith("my-plugin");
      expect(result).toEqual(mockResult);
    });
  });

  // ---------------------------------------------------------------------------
  describe("PLUGIN_UNINSTALL", () => {
    it("calls uninstallPlugin with name and options, returns success shape", async () => {
      const options = { keepConfig: false };

      const result = await invokeHandler(IPC.PLUGIN_UNINSTALL, "my-plugin", options);

      expect(uninstallPluginMock).toHaveBeenCalledWith("my-plugin", options);
      expect(result).toEqual({ name: "my-plugin", success: true });
    });
  });

  // ---------------------------------------------------------------------------
  describe("PLUGIN_ENABLE", () => {
    it("calls enablePlugin with name and returns success shape", async () => {
      const result = await invokeHandler(IPC.PLUGIN_ENABLE, "my-plugin");

      expect(enablePluginMock).toHaveBeenCalledWith("my-plugin");
      expect(result).toEqual({ name: "my-plugin", success: true });
    });

    it("propagates errors from enablePlugin", async () => {
      enablePluginMock.mockRejectedValue(new Error("plugin is incompatible"));

      await expect(invokeHandler(IPC.PLUGIN_ENABLE, "bad-plugin")).rejects.toThrow("plugin is incompatible");
    });
  });

  // ---------------------------------------------------------------------------
  describe("PLUGIN_DISABLE", () => {
    it("calls disablePlugin with name and returns success shape", async () => {
      const result = await invokeHandler(IPC.PLUGIN_DISABLE, "my-plugin");

      expect(disablePluginMock).toHaveBeenCalledWith("my-plugin");
      expect(result).toEqual({ name: "my-plugin", success: true });
    });
  });

  // ---------------------------------------------------------------------------
  describe("PLUGIN_SET_PROJECT_OVERRIDE", () => {
    it("calls setPluginProjectOverride with name, projectPath, and override, returns success shape", async () => {
      const override = { enabled: true, components: { componentA: true } };

      const result = await invokeHandler(IPC.PLUGIN_SET_PROJECT_OVERRIDE, "my-plugin", "/path/to/project", override);

      expect(setPluginProjectOverrideMock).toHaveBeenCalledWith("my-plugin", "/path/to/project", override);
      expect(result).toEqual({ name: "my-plugin", projectPath: "/path/to/project", override, success: true });
    });
  });

  // ---------------------------------------------------------------------------
  describe("PLUGIN_RESET_PROJECT_OVERRIDE", () => {
    it("calls resetPluginProjectOverride with name and projectPath, returns success shape", async () => {
      const result = await invokeHandler(IPC.PLUGIN_RESET_PROJECT_OVERRIDE, "my-plugin", "/path/to/project");

      expect(resetPluginProjectOverrideMock).toHaveBeenCalledWith("my-plugin", "/path/to/project");
      expect(result).toEqual({ name: "my-plugin", projectPath: "/path/to/project", success: true });
    });
  });

  // ---------------------------------------------------------------------------
  describe("PLUGIN_APPROVE", () => {
    it("calls approvePluginComponent with name and component, returns success shape", async () => {
      const result = await invokeHandler(IPC.PLUGIN_APPROVE, "my-plugin", "componentX");

      expect(approvePluginComponentMock).toHaveBeenCalledWith("my-plugin", "componentX");
      expect(result).toEqual({ name: "my-plugin", component: "componentX", success: true });
    });
  });

  // ---------------------------------------------------------------------------
  describe("PLUGIN_CONFIG_SET", () => {
    it("calls pluginConfigSet with name, key, value, and projectPath, returns success shape", async () => {
      const result = await invokeHandler(IPC.PLUGIN_CONFIG_SET, "my-plugin", "configKey", "configValue", "/project");

      expect(pluginConfigSetMock).toHaveBeenCalledWith("my-plugin", "configKey", "configValue", "/project");
      expect(result).toEqual({ name: "my-plugin", key: "configKey", value: "configValue", success: true });
    });

    it("calls pluginConfigSet without projectPath when not provided", async () => {
      const result = await invokeHandler(IPC.PLUGIN_CONFIG_SET, "my-plugin", "configKey", "configValue");

      expect(pluginConfigSetMock).toHaveBeenCalledWith("my-plugin", "configKey", "configValue", undefined);
      expect(result).toEqual({ name: "my-plugin", key: "configKey", value: "configValue", success: true });
    });
  });

  // ---------------------------------------------------------------------------
  describe("PLUGIN_SYNC", () => {
    it("calls pluginSync and returns success shape", async () => {
      const result = await invokeHandler(IPC.PLUGIN_SYNC);

      expect(pluginSyncMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true });
    });

    it("propagates errors from pluginSync", async () => {
      pluginSyncMock.mockRejectedValue(new Error("sync failed"));

      await expect(invokeHandler(IPC.PLUGIN_SYNC)).rejects.toThrow("sync failed");
    });
  });

  // ---------------------------------------------------------------------------
  describe("PLUGIN_STATUS", () => {
    it("calls getPluginStatus with optional name and returns the result", async () => {
      const mockResult = { name: "my-plugin", enabled: true, version: "1.0.0", status: "ready" };
      getPluginStatusMock.mockResolvedValue(mockResult);

      const result = await invokeHandler(IPC.PLUGIN_STATUS, "my-plugin");

      expect(getPluginStatusMock).toHaveBeenCalledWith("my-plugin");
      expect(result).toEqual(mockResult);
    });

    it("calls getPluginStatus with undefined name when not provided", async () => {
      const mockResult = [
        { name: "plugin1", enabled: true },
        { name: "plugin2", enabled: false }
      ];
      getPluginStatusMock.mockResolvedValue(mockResult);

      const result = await invokeHandler(IPC.PLUGIN_STATUS);

      expect(getPluginStatusMock).toHaveBeenCalledWith(undefined);
      expect(result).toEqual(mockResult);
    });
  });

  // ---------------------------------------------------------------------------
  describe("PLUGIN_LIST", () => {
    it("calls listPlugins and returns the plugin list", async () => {
      const mockList = [
        { name: "plugin1", enabled: true, version: "1.0.0" },
        { name: "plugin2", enabled: false, version: "2.0.0" }
      ];
      listPluginsMock.mockResolvedValue(mockList);

      const result = await invokeHandler(IPC.PLUGIN_LIST);

      expect(listPluginsMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockList);
    });

    it("propagates errors from listPlugins", async () => {
      listPluginsMock.mockRejectedValue(new Error("failed to load plugin manifest"));

      await expect(invokeHandler(IPC.PLUGIN_LIST)).rejects.toThrow("failed to load plugin manifest");
    });
  });

  describe("marketplace IPC", () => {
    it("lists and browses marketplaces", async () => {
      listMarketplacesMock.mockResolvedValueOnce([{ name: "openai-curated" }]);
      listMarketplacePluginsMock.mockResolvedValueOnce([{ id: "figma@openai-curated" }]);
      expect(await invokeHandler(IPC.MARKETPLACE_LIST)).toEqual([{ name: "openai-curated" }]);
      expect(await invokeHandler(IPC.MARKETPLACE_BROWSE, "figma")).toEqual([{ id: "figma@openai-curated" }]);
      expect(listMarketplacePluginsMock).toHaveBeenCalledWith("figma");
    });

    it("adds, refreshes, toggles, and removes a marketplace", async () => {
      await invokeHandler(IPC.MARKETPLACE_ADD, "acme/plugins", ".claude-plugin/marketplace.json");
      await invokeHandler(IPC.MARKETPLACE_REFRESH, "team-tools");
      await invokeHandler(IPC.MARKETPLACE_SET_AUTO_UPDATE, "team-tools", true);
      expect(await invokeHandler(IPC.MARKETPLACE_REMOVE, "team-tools")).toEqual({ name: "team-tools", success: true });
      expect(addMarketplaceMock).toHaveBeenCalledWith("acme/plugins", ".claude-plugin/marketplace.json");
      expect(refreshMarketplaceWithPluginsMock).toHaveBeenCalledWith("team-tools");
      expect(setMarketplaceAutoUpdateMock).toHaveBeenCalledWith("team-tools", true);
      expect(removeMarketplaceMock).toHaveBeenCalledWith("team-tools");
    });

    it("inspects and installs a marketplace plugin", async () => {
      await invokeHandler(IPC.MARKETPLACE_INSPECT_PLUGIN, "reviewer@team-tools");
      await invokeHandler(IPC.MARKETPLACE_INSTALL_PLUGIN, "reviewer@team-tools");
      expect(inspectMarketplacePluginMock).toHaveBeenCalledWith("reviewer@team-tools");
      expect(installMarketplacePluginMock).toHaveBeenCalledWith("reviewer@team-tools");
    });
  });
});
