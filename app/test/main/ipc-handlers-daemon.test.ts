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

describe("ipc-handlers.ts - daemon + settings + misc group", () => {
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
  const loadConfigMock = vi.fn();
  const loadMergedConfigMock = vi.fn();
  const startDaemonMock = vi.fn();
  const stopDaemonMock = vi.fn();
  const restartDaemonMock = vi.fn();
  const buildStatusReportMock = vi.fn();
  const loadManagedIndexMock = vi.fn();

  const secretsSetSecretMock = vi.fn();
  const secretsGetSecretMock = vi.fn(() => null);
  const secretsResolveMaybeSecretMock = vi.fn((value: string) => value);

  class MockSecretsManager {
    setSecret = secretsSetSecretMock;
    getSecret = secretsGetSecretMock;
    resolveMaybeSecret = secretsResolveMaybeSecretMock;
  }

  // Sibling module mocks extracted for assertion
  const updateTrayForDaemonStatusMock = vi.fn();
  const openDashboardMock = vi.fn();
  const loadDesktopSettingsMock = vi.fn();
  const updateDesktopSettingsMock = vi.fn();
  const applyStartOnLoginSettingMock = vi.fn();
  const setAutoUpdateEnabledMock = vi.fn();
  const checkForUpdatesNowMock = vi.fn();
  const quitAppMock = vi.fn();
  const getPendingAuthMock = vi.fn();
  const dismissPendingAuthMock = vi.fn();

  let fakeConfig: Record<string, any>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    registeredHandlers.clear();

    fakeConfig = makeConfig();

    // ---- sensible defaults; individual tests override via mockReturnValue/
    // mockImplementation *after* this hook runs, before calling invokeHandler.
    loadConfigMock.mockReturnValue(fakeConfig);
    loadMergedConfigMock.mockReturnValue(fakeConfig);
    startDaemonMock.mockResolvedValue({ started: true });
    stopDaemonMock.mockReturnValue({ started: false });
    restartDaemonMock.mockResolvedValue({ started: true });
    buildStatusReportMock.mockResolvedValue({ status: "ok" });
    loadManagedIndexMock.mockReturnValue({ schemaVersion: 1, managed: {} });
    openDashboardMock.mockReturnValue(undefined);
    loadDesktopSettingsMock.mockReturnValue({});
    updateDesktopSettingsMock.mockImplementation((patch: unknown) => patch);
    applyStartOnLoginSettingMock.mockReturnValue(undefined);
    setAutoUpdateEnabledMock.mockReturnValue(undefined);
    checkForUpdatesNowMock.mockResolvedValue({});
    quitAppMock.mockReturnValue(undefined);
    getPendingAuthMock.mockReturnValue([]);
    dismissPendingAuthMock.mockReturnValue(undefined);

    vi.doMock("electron", () => ({
      app: { getAppPath: vi.fn(() => "/fake/app-path") },
      ipcMain: { handle: ipcMainHandleMock },
      dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
      shell: { openExternal: vi.fn(async () => undefined) }
    }));

    vi.doMock("../../src/main/dashboard", () => ({
      openDashboard: openDashboardMock
    }));
    vi.doMock("../../src/main/settings-store", () => ({
      loadDesktopSettings: loadDesktopSettingsMock,
      updateDesktopSettings: updateDesktopSettingsMock
    }));
    vi.doMock("../../src/main/login-item", () => ({
      applyStartOnLoginSetting: applyStartOnLoginSettingMock
    }));
    vi.doMock("../../src/main/update-manager", () => ({
      checkForUpdatesNow: checkForUpdatesNowMock,
      setAutoUpdateEnabled: setAutoUpdateEnabledMock
    }));
    vi.doMock("../../src/main/tray", () => ({
      updateTrayForDaemonStatus: updateTrayForDaemonStatusMock
    }));
    vi.doMock("../../src/main/auth-events", () => ({
      dismissPendingAuth: dismissPendingAuthMock,
      getPendingAuth: getPendingAuthMock,
      queuePendingAuth: vi.fn()
    }));
    vi.doMock("../../src/main/app-control", () => ({
      quitApp: quitAppMock
    }));

    // Full named-export list copied from ipc-handlers.ts's
    // `import { ... } from "@mcpx/core"` block - keep in sync with that file.
    vi.doMock("@mcpx/core", () => ({
      loadConfig: loadConfigMock,
      mutateConfig: vi.fn(),
      loadMergedConfig: loadMergedConfigMock,
      registerProject: vi.fn(),
      unregisterProject: vi.fn(),
      setProjectServerEnabled: vi.fn(() => ({ effective: true })),
      getDaemonStatus: vi.fn(() => ({ running: false })),
      startDaemon: startDaemonMock,
      stopDaemon: stopDaemonMock,
      restartDaemon: restartDaemonMock,
      syncAllClients: vi.fn(),
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
      SecretsManager: MockSecretsManager,
      buildStatusReport: buildStatusReportMock,
      loadManagedIndex: loadManagedIndexMock,
      probeHttpAuthRequirement: vi.fn(),
      applyAuthReference: vi.fn(),
      resolveAuthTarget: vi.fn(),
      toSecretRef: vi.fn(),
      maybePrefixBearer: vi.fn(),
      parseCliAddCommand: vi.fn(),
      tokenizeCommandLine: vi.fn(),
      runOAuthLogin: vi.fn(async () => ({ success: true })),
      PluginManager: vi.fn(),
      ensureGatewayToken: vi.fn()
    }));

    const { registerIpcHandlers } = await import("../../src/main/ipc-handlers");
    registerIpcHandlers();
  });

  // ---------------------------------------------------------------------------
  describe("DAEMON_START", () => {
    it("starts the daemon and updates the tray status on success", async () => {
      const result = await invokeHandler(IPC.DAEMON_START);

      expect(loadConfigMock).toHaveBeenCalledTimes(1);
      expect(startDaemonMock).toHaveBeenCalledWith(fakeConfig, expect.any(String), expect.any(MockSecretsManager));
      expect(updateTrayForDaemonStatusMock).toHaveBeenCalledWith(true);
      expect(result).toEqual({ started: true });
    });

    it("propagates errors from loadConfig and updates tray to stopped", async () => {
      loadConfigMock.mockImplementation(() => {
        throw new Error("config file not found");
      });

      await expect(invokeHandler(IPC.DAEMON_START)).rejects.toThrow("Cannot start daemon: config file not found");
      expect(updateTrayForDaemonStatusMock).toHaveBeenCalledWith(false);
    });

    it("throws when startDaemon returns started false", async () => {
      startDaemonMock.mockResolvedValue({ started: false, message: "port 37373 already in use" });

      await expect(invokeHandler(IPC.DAEMON_START)).rejects.toThrow("port 37373 already in use");
      expect(updateTrayForDaemonStatusMock).toHaveBeenCalledWith(false);
    });
  });

  // ---------------------------------------------------------------------------
  describe("DAEMON_STOP", () => {
    it("stops the daemon and updates the tray status", async () => {
      const result = await invokeHandler(IPC.DAEMON_STOP);

      expect(stopDaemonMock).toHaveBeenCalledTimes(1);
      expect(updateTrayForDaemonStatusMock).toHaveBeenCalledWith(false);
      expect(result).toEqual({ started: false });
    });
  });

  // ---------------------------------------------------------------------------
  describe("DAEMON_RESTART", () => {
    it("restarts the daemon and updates the tray status", async () => {
      const result = await invokeHandler(IPC.DAEMON_RESTART);

      expect(loadConfigMock).toHaveBeenCalledTimes(1);
      expect(restartDaemonMock).toHaveBeenCalledWith(fakeConfig, expect.any(String), expect.any(MockSecretsManager));
      expect(updateTrayForDaemonStatusMock).toHaveBeenCalledWith(true);
      expect(result).toEqual({ started: true });
    });
  });

  // ---------------------------------------------------------------------------
  describe("GET_STATUS", () => {
    it("loads merged config and returns the status report", async () => {
      const result = await invokeHandler(IPC.GET_STATUS);

      expect(loadMergedConfigMock).toHaveBeenCalledTimes(1);
      expect(loadManagedIndexMock).toHaveBeenCalledTimes(1);
      expect(buildStatusReportMock).toHaveBeenCalledWith(fakeConfig, { schemaVersion: 1, managed: {} });
      expect(result).toEqual({ status: "ok" });
    });
  });

  // ---------------------------------------------------------------------------
  describe("GET_DESKTOP_SETTINGS", () => {
    it("returns the loaded desktop settings", async () => {
      loadDesktopSettingsMock.mockReturnValue({ startOnLoginEnabled: true, autoUpdateEnabled: false });

      const result = await invokeHandler(IPC.GET_DESKTOP_SETTINGS);

      expect(loadDesktopSettingsMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ startOnLoginEnabled: true, autoUpdateEnabled: false });
    });
  });

  // ---------------------------------------------------------------------------
  describe("UPDATE_DESKTOP_SETTINGS", () => {
    it("updates desktop settings and applies the relevant system changes", async () => {
      const patch = { startOnLoginEnabled: true, autoUpdateEnabled: false };
      updateDesktopSettingsMock.mockReturnValue(patch);

      const result = await invokeHandler(IPC.UPDATE_DESKTOP_SETTINGS, patch);

      expect(updateDesktopSettingsMock).toHaveBeenCalledWith(patch);
      expect(applyStartOnLoginSettingMock).toHaveBeenCalledWith(true);
      expect(setAutoUpdateEnabledMock).toHaveBeenCalledWith(false);
      expect(result).toEqual(patch);
    });
  });

  // ---------------------------------------------------------------------------
  describe("CHECK_FOR_UPDATES", () => {
    it("checks for updates and returns the result", async () => {
      checkForUpdatesNowMock.mockResolvedValue({ updateAvailable: true, version: "1.2.3" });

      const result = await invokeHandler(IPC.CHECK_FOR_UPDATES);

      expect(checkForUpdatesNowMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ updateAvailable: true, version: "1.2.3" });
    });
  });

  // ---------------------------------------------------------------------------
  describe("GET_PENDING_AUTH", () => {
    it("returns the list of pending auth requests", async () => {
      getPendingAuthMock.mockReturnValue([
        { serverName: "api-server", oauthLikely: true, status: 401 }
      ]);

      const result = await invokeHandler(IPC.GET_PENDING_AUTH);

      expect(getPendingAuthMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual([{ serverName: "api-server", oauthLikely: true, status: 401 }]);
    });
  });

  // ---------------------------------------------------------------------------
  describe("DISMISS_AUTH", () => {
    it("dismisses the pending auth for the given server", async () => {
      const result = await invokeHandler(IPC.DISMISS_AUTH, "api-server");

      expect(dismissPendingAuthMock).toHaveBeenCalledWith("api-server");
      expect(result).toEqual({ dismissed: "api-server" });
    });
  });

  // ---------------------------------------------------------------------------
  describe("START_OAUTH", () => {
    beforeEach(() => {
      fakeConfig.servers = {
        "http-api": { transport: "http", url: "https://example.com/mcp" }
      };
    });

    it("starts the OAuth login flow for the given HTTP server", async () => {
      const result = await invokeHandler(IPC.START_OAUTH, "http-api");

      expect(loadConfigMock).toHaveBeenCalled();
      expect(dismissPendingAuthMock).toHaveBeenCalledWith("http-api");
      expect(result).toEqual({ success: true });
    });

    it("rejects when the server is not found", async () => {
      await expect(invokeHandler(IPC.START_OAUTH, "nonexistent")).rejects.toThrow(
        'Server "nonexistent" not found.'
      );
    });

    it("rejects when the server is not HTTP", async () => {
      fakeConfig.servers = {
        "stdio-server": { transport: "stdio", command: "node", args: ["server.js"] }
      };

      await expect(invokeHandler(IPC.START_OAUTH, "stdio-server")).rejects.toThrow(
        "OAuth login only supports HTTP servers."
      );
    });
  });

  // ---------------------------------------------------------------------------
  describe("OPEN_DASHBOARD", () => {
    it("opens the dashboard window", async () => {
      await invokeHandler(IPC.OPEN_DASHBOARD);

      expect(openDashboardMock).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  describe("QUIT_APP", () => {
    it("quits the application", async () => {
      await invokeHandler(IPC.QUIT_APP);

      expect(quitAppMock).toHaveBeenCalledTimes(1);
    });
  });
});
