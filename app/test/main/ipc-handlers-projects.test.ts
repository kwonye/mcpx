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

describe("ipc-handlers.ts - projects group", () => {
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
  const mutateConfigMock = vi.fn();
  const syncAllClientsMock = vi.fn();
  const persistSyncStateMock = vi.fn();
  const registerProjectMock = vi.fn();
  const unregisterProjectMock = vi.fn();
  const setProjectServerEnabledMock = vi.fn();

  // dialog.showOpenDialog is a special case - it's on the electron mock
  // but we need to override it per test
  const dialogShowOpenDialogMock = vi.fn(async () => ({ canceled: true, filePaths: [] }));

  // SecretsManager methods are shared across every `new SecretsManager()`
  // instance a handler creates, so tests can assert on secret writes without
  // needing to capture the specific instance a handler constructed.
  const secretsSetSecretMock = vi.fn();
  const secretsGetSecretMock = vi.fn(() => null);
  const secretsResolveMaybeSecretMock = vi.fn((value: string) => value);

  class MockSecretsManager {
    setSecret = secretsSetSecretMock;
    getSecret = secretsGetSecretMock;
    resolveMaybeSecret = secretsResolveMaybeSecretMock;
  }

  let fakeConfig: Record<string, any>;
  let fakeSyncSummary: Record<string, any>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    registeredHandlers.clear();

    fakeConfig = makeConfig();
    fakeSyncSummary = makeSyncSummary();

    // ---- sensible defaults; individual tests override via mockReturnValue/
    // mockImplementation *after* this hook runs, before calling invokeHandler.
    loadConfigMock.mockReturnValue(fakeConfig);
    loadMergedConfigMock.mockReturnValue(fakeConfig);
    mutateConfigMock.mockImplementation(async (fn: (config: any) => unknown) => fn(fakeConfig));
    syncAllClientsMock.mockReturnValue(fakeSyncSummary);
    persistSyncStateMock.mockReturnValue(undefined);
    registerProjectMock.mockReturnValue(undefined);
    unregisterProjectMock.mockReturnValue(undefined);
    setProjectServerEnabledMock.mockReturnValue({ effective: true, reason: "enabled globally" });
    dialogShowOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [] });

    vi.doMock("electron", () => ({
      app: { getAppPath: vi.fn(() => "/fake/app-path") },
      ipcMain: { handle: ipcMainHandleMock },
      dialog: { showOpenDialog: dialogShowOpenDialogMock },
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
      loadConfig: loadConfigMock,
      mutateConfig: mutateConfigMock,
      loadMergedConfig: loadMergedConfigMock,
      registerProject: registerProjectMock,
      unregisterProject: unregisterProjectMock,
      setProjectServerEnabled: setProjectServerEnabledMock,
      getDaemonStatus: vi.fn(() => ({ running: false })),
      startDaemon: vi.fn(async () => ({ started: true })),
      stopDaemon: vi.fn(() => ({ started: false })),
      restartDaemon: vi.fn(async () => ({ started: true })),
      syncAllClients: syncAllClientsMock,
      persistSyncState: persistSyncStateMock,
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
      ensureGatewayToken: vi.fn()
    }));

    const { registerIpcHandlers } = await import("../../src/main/ipc-handlers");
    registerIpcHandlers();
  });

  // ---------------------------------------------------------------------------
  describe("PROJECT_INIT", () => {
    it("registers through mutateConfig with threaded-through args and returns success with sync summary", async () => {
      const result = await invokeHandler(IPC.PROJECT_INIT, "/path/to/project", "My Project");

      expect(mutateConfigMock).toHaveBeenCalled();
      expect(registerProjectMock).toHaveBeenCalledWith(fakeConfig, "/path/to/project", "My Project");
      expect(result).toEqual({ success: true, sync: fakeSyncSummary });
    });

    it("rejects when registerProject rejects (e.g. project already exists)", async () => {
      registerProjectMock.mockImplementation(() => {
        throw new Error("Project already registered");
      });

      await expect(invokeHandler(IPC.PROJECT_INIT, "/path/to/project", "My Project")).rejects.toThrow(
        "Project already registered"
      );
    });
  });

  // ---------------------------------------------------------------------------
  describe("PROJECT_REMOVE", () => {
    it("unregisters through mutateConfig with threaded-through args and returns success with sync summary", async () => {
      const result = await invokeHandler(IPC.PROJECT_REMOVE, "/path/to/project");

      expect(mutateConfigMock).toHaveBeenCalled();
      expect(unregisterProjectMock).toHaveBeenCalledWith(fakeConfig, "/path/to/project");
      expect(result).toEqual({ success: true, sync: fakeSyncSummary });
    });

    it("rejects when unregisterProject rejects (e.g. project not found)", async () => {
      unregisterProjectMock.mockImplementation(() => {
        throw new Error("Project not found");
      });

      await expect(invokeHandler(IPC.PROJECT_REMOVE, "/path/to/project")).rejects.toThrow("Project not found");
    });
  });

  // ---------------------------------------------------------------------------
  describe("PROJECT_SET_SERVER_ENABLED", () => {
    it("sets server enabled through mutateConfig with threaded-through args and returns update details", async () => {
      setProjectServerEnabledMock.mockReturnValue({ effective: true, reason: "enabled globally" });

      const result = await invokeHandler(IPC.PROJECT_SET_SERVER_ENABLED, "/path/to/project", "my-server", true);

      expect(mutateConfigMock).toHaveBeenCalled();
      expect(setProjectServerEnabledMock).toHaveBeenCalledWith(fakeConfig, "/path/to/project", "my-server", true);
      expect(result).toEqual({
        updated: "my-server",
        projectPath: "/path/to/project",
        enabled: true,
        sync: fakeSyncSummary,
        effective: true,
        reason: "enabled globally"
      });
    });

    it("rejects when setProjectServerEnabled rejects (e.g. invalid project)", async () => {
      setProjectServerEnabledMock.mockImplementation(() => {
        throw new Error("Project not found");
      });

      await expect(invokeHandler(IPC.PROJECT_SET_SERVER_ENABLED, "/path/to/project", "my-server", true)).rejects.toThrow(
        "Project not found"
      );
    });
  });

  // ---------------------------------------------------------------------------
  describe("SELECT_DIRECTORY", () => {
    it("returns the selected directory path when user picks a directory", async () => {
      dialogShowOpenDialogMock.mockResolvedValue({
        canceled: false,
        filePaths: ["/Users/will/my-project"]
      });

      const result = await invokeHandler(IPC.SELECT_DIRECTORY);

      expect(result).toEqual("/Users/will/my-project");
    });

    it("returns null when user cancels the dialog", async () => {
      dialogShowOpenDialogMock.mockResolvedValue({
        canceled: true,
        filePaths: []
      });

      const result = await invokeHandler(IPC.SELECT_DIRECTORY);

      expect(result).toBeNull();
    });

    it("returns null when filePaths array is empty even if not explicitly canceled", async () => {
      dialogShowOpenDialogMock.mockResolvedValue({
        canceled: false,
        filePaths: []
      });

      const result = await invokeHandler(IPC.SELECT_DIRECTORY);

      expect(result).toBeNull();
    });
  });
});
