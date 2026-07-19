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

describe("ipc-handlers.ts - skills group", () => {
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
  const listSkillsMock = vi.fn();
  const getSkillMock = vi.fn();
  const saveSkillMock = vi.fn();
  const deleteSkillMock = vi.fn();

  class MockSecretsManager {
    setSecret = vi.fn();
    getSecret = vi.fn(() => null);
    resolveMaybeSecret = vi.fn((value: string) => value);
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
    listSkillsMock.mockReturnValue([]);
    getSkillMock.mockReturnValue(null);
    saveSkillMock.mockReturnValue(undefined);
    deleteSkillMock.mockReturnValue(undefined);

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
      mutateConfig: vi.fn(async (fn: (config: any) => unknown) => fn(fakeConfig)),
      loadMergedConfig: vi.fn(() => fakeConfig),
      registerProject: vi.fn(),
      unregisterProject: vi.fn(),
      setProjectServerEnabled: vi.fn(() => ({ effective: true })),
      getDaemonStatus: vi.fn(() => ({ running: false })),
      startDaemon: vi.fn(async () => ({ started: true })),
      stopDaemon: vi.fn(() => ({ started: false })),
      restartDaemon: vi.fn(async () => ({ started: true })),
      syncAllClients: vi.fn(() => fakeSyncSummary),
      persistSyncState: vi.fn(),
      addServer: vi.fn(),
      removeServer: vi.fn(),
      setServerEnabled: vi.fn(),
      updateServer: vi.fn(),
      listAuthBindings: vi.fn(() => []),
      listSkills: listSkillsMock,
      getSkill: getSkillMock,
      saveSkill: saveSkillMock,
      deleteSkill: deleteSkillMock,
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
  describe("LIST_SKILLS", () => {
    it("returns the list of skills from listSkills()", async () => {
      const mockSkills = [
        { id: "skill1", title: "Skill 1", description: "First skill" },
        { id: "skill2", title: "Skill 2", description: "Second skill" }
      ];
      listSkillsMock.mockReturnValue(mockSkills);

      const result = await invokeHandler(IPC.LIST_SKILLS);

      expect(listSkillsMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockSkills);
    });
  });

  // ---------------------------------------------------------------------------
  describe("GET_SKILL", () => {
    it("returns the skill with the given id from getSkill()", async () => {
      const mockSkill = { id: "skill1", content: "skill content" };
      getSkillMock.mockReturnValue(mockSkill);

      const result = await invokeHandler(IPC.GET_SKILL, "skill1");

      expect(getSkillMock).toHaveBeenCalledTimes(1);
      expect(getSkillMock).toHaveBeenCalledWith("skill1");
      expect(result).toEqual(mockSkill);
    });
  });

  // ---------------------------------------------------------------------------
  describe("SAVE_SKILL", () => {
    it("saves the skill with the given id and content, returning success", async () => {
      const result = await invokeHandler(IPC.SAVE_SKILL, "skill1", "new content");

      expect(saveSkillMock).toHaveBeenCalledTimes(1);
      expect(saveSkillMock).toHaveBeenCalledWith("skill1", "new content");
      expect(result).toEqual({ id: "skill1", success: true });
    });

    it("propagates errors from saveSkill", async () => {
      saveSkillMock.mockImplementation(() => {
        throw new Error("failed to write skill file");
      });

      await expect(invokeHandler(IPC.SAVE_SKILL, "skill1", "content")).rejects.toThrow(
        "failed to write skill file"
      );
    });
  });

  // ---------------------------------------------------------------------------
  describe("DELETE_SKILL", () => {
    it("deletes the skill with the given id, returning success", async () => {
      const result = await invokeHandler(IPC.DELETE_SKILL, "skill1");

      expect(deleteSkillMock).toHaveBeenCalledTimes(1);
      expect(deleteSkillMock).toHaveBeenCalledWith("skill1");
      expect(result).toEqual({ id: "skill1", success: true });
    });
  });
});
