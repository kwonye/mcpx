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

describe("ipc-handlers.ts - servers group", () => {
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
  const loadConfigMock = vi.fn();
  const loadMergedConfigMock = vi.fn();
  const mutateConfigMock = vi.fn();
  const syncAllClientsMock = vi.fn();
  const persistSyncStateMock = vi.fn();
  const addServerMock = vi.fn();
  const removeServerMock = vi.fn();
  const setServerEnabledMock = vi.fn();
  const updateServerMock = vi.fn();
  const parseCliAddCommandMock = vi.fn();
  const tokenizeCommandLineMock = vi.fn();
  const probeHttpAuthRequirementMock = vi.fn();
  const resolveAuthTargetMock = vi.fn();
  const maybePrefixBearerMock = vi.fn();
  const toSecretRefMock = vi.fn();
  const applyAuthReferenceMock = vi.fn();
  const ensureGatewayTokenMock = vi.fn();

  // "./auth-events" is a sibling module (not @mcpx/core) but ADD_SERVER/
  // CONFIGURE_AUTH/EXECUTE_CLI_COMMAND call into it directly, so tests in
  // this group need to assert on it too.
  const queuePendingAuthMock = vi.fn();
  const dismissPendingAuthMock = vi.fn();

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
    addServerMock.mockReturnValue(undefined);
    removeServerMock.mockReturnValue(undefined);
    setServerEnabledMock.mockReturnValue(undefined);
    updateServerMock.mockReturnValue(undefined);
    parseCliAddCommandMock.mockReturnValue({ name: "stub", spec: { transport: "stdio", command: "stub" } });
    tokenizeCommandLineMock.mockImplementation((command: string) => [command]);
    probeHttpAuthRequirementMock.mockResolvedValue({ authRequired: false });
    resolveAuthTargetMock.mockReturnValue({ kind: "header", key: "Authorization" });
    maybePrefixBearerMock.mockImplementation((_target: unknown, value: string) => value);
    toSecretRefMock.mockImplementation((name: string) => `secret://${name}`);
    applyAuthReferenceMock.mockReturnValue(undefined);
    // Falsy by default so the fire-and-forget refreshTokenCountsSoon() helper
    // (invoked via queueTokenCountRefresh() at the end of every mutating
    // handler) bails out before attempting a real fetch() call. See note on
    // EXECUTE_CLI_COMMAND / SYNC_ALL below if you need to exercise that path.
    ensureGatewayTokenMock.mockReturnValue(undefined);

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
      dismissPendingAuth: dismissPendingAuthMock,
      getPendingAuth: vi.fn(() => []),
      queuePendingAuth: queuePendingAuthMock
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
      registerProject: vi.fn(),
      unregisterProject: vi.fn(),
      setProjectServerEnabled: vi.fn(() => ({ effective: true })),
      getDaemonStatus: vi.fn(() => ({ running: false })),
      startDaemon: vi.fn(async () => ({ started: true })),
      stopDaemon: vi.fn(() => ({ started: false })),
      restartDaemon: vi.fn(async () => ({ started: true })),
      syncAllClients: syncAllClientsMock,
      persistSyncState: persistSyncStateMock,
      addServer: addServerMock,
      removeServer: removeServerMock,
      setServerEnabled: setServerEnabledMock,
      updateServer: updateServerMock,
      listAuthBindings: vi.fn(() => []),
      listSkills: vi.fn(() => []),
      getSkill: vi.fn(() => null),
      saveSkill: vi.fn(),
      deleteSkill: vi.fn(),
      SecretsManager: MockSecretsManager,
      buildStatusReport: vi.fn(async () => ({})),
      loadManagedIndex: vi.fn(() => ({ schemaVersion: 1, managed: {} })),
      probeHttpAuthRequirement: probeHttpAuthRequirementMock,
      applyAuthReference: applyAuthReferenceMock,
      resolveAuthTarget: resolveAuthTargetMock,
      toSecretRef: toSecretRefMock,
      maybePrefixBearer: maybePrefixBearerMock,
      parseCliAddCommand: parseCliAddCommandMock,
      tokenizeCommandLine: tokenizeCommandLineMock,
      runOAuthLogin: vi.fn(async () => ({ success: true })),
      // Imported by ipc-handlers.ts but never referenced in its body (dead
      // import) - see report. Stubbed only so the mock object's shape
      // matches the real module's.
      PluginManager: vi.fn(),
      ensureGatewayToken: ensureGatewayTokenMock
    }));

    const { registerIpcHandlers } = await import("../../src/main/ipc-handlers");
    registerIpcHandlers();
  });

  // ---------------------------------------------------------------------------
  describe("GET_SERVERS", () => {
    it("maps the merged config's servers record into a named array", async () => {
      fakeConfig.servers = {
        alpha: { transport: "stdio", command: "node", enabled: true },
        beta: { transport: "http", url: "https://example.com", enabled: false }
      };

      const result = await invokeHandler(IPC.GET_SERVERS);

      expect(loadMergedConfigMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual([
        { name: "alpha", transport: "stdio", command: "node", enabled: true },
        { name: "beta", transport: "http", url: "https://example.com", enabled: false }
      ]);
    });

    it("propagates errors from loadMergedConfig", async () => {
      loadMergedConfigMock.mockImplementation(() => {
        throw new Error("config is corrupt");
      });

      await expect(invokeHandler(IPC.GET_SERVERS)).rejects.toThrow("config is corrupt");
    });
  });

  // ---------------------------------------------------------------------------
  describe("ADD_SERVER", () => {
    const spec = { transport: "stdio" as const, command: "node", args: ["server.js"] };

    it("adds through mutateConfig with threaded-through args and returns the sync summary", async () => {
      const result = await invokeHandler(IPC.ADD_SERVER, "my-server", spec);

      expect(mutateConfigMock).toHaveBeenCalled();
      expect(addServerMock).toHaveBeenCalledWith(fakeConfig, "my-server", spec, true);
      expect(result).toEqual({ added: "my-server", sync: fakeSyncSummary });
    });

    it("rejects when addServer rejects (e.g. duplicate name)", async () => {
      addServerMock.mockImplementation(() => {
        throw new Error('Server "my-server" already exists. Use --force to overwrite.');
      });

      await expect(invokeHandler(IPC.ADD_SERVER, "my-server", spec)).rejects.toThrow("already exists");
    });

    it("queues pending auth when an HTTP server probe reports auth is required", async () => {
      const httpSpec = { transport: "http" as const, url: "https://example.com/mcp" };
      probeHttpAuthRequirementMock.mockResolvedValue({ authRequired: true, status: 401, oauthLikely: true });

      const result = await invokeHandler(IPC.ADD_SERVER, "http-server", httpSpec);

      expect(queuePendingAuthMock).toHaveBeenCalledWith({ serverName: "http-server", oauthLikely: true, status: 401 });
      expect(result).toMatchObject({ authRequired: true, authStatus: 401, oauthLikely: true });
    });
  });

  // ---------------------------------------------------------------------------
  describe("UPDATE_SERVER", () => {
    const spec = { transport: "stdio" as const, command: "node", args: ["server.js"] };

    it("updates through mutateConfig with threaded-through args and returns the sync summary", async () => {
      const result = await invokeHandler(IPC.UPDATE_SERVER, "my-server", spec);

      expect(mutateConfigMock).toHaveBeenCalled();
      expect(updateServerMock).toHaveBeenCalledWith(fakeConfig, "my-server", spec);
      expect(result).toEqual({ updated: "my-server", sync: fakeSyncSummary });
    });

    it("stores a provided resolvedSecrets value via SecretsManager before updating", async () => {
      await invokeHandler(IPC.UPDATE_SERVER, "my-server", spec, { API_KEY: "shh" });

      expect(secretsSetSecretMock).toHaveBeenCalledWith("API_KEY", "shh");
    });

    it("migrates a plain-text secret HTTP header to the encrypted store", async () => {
      const httpSpec = {
        transport: "http" as const,
        url: "https://example.com/mcp",
        headers: { API_KEY: "shh", "X-Label": "public" }
      };

      await invokeHandler(IPC.UPDATE_SERVER, "My Server", httpSpec);

      expect(secretsGetSecretMock).toHaveBeenCalledWith("auth_my_server_header_api_key");
      expect(secretsSetSecretMock).toHaveBeenCalledWith("auth_my_server_header_api_key", "shh");
      expect(updateServerMock).toHaveBeenCalledWith(fakeConfig, "My Server", {
        ...httpSpec,
        headers: {
          API_KEY: "secret://auth_my_server_header_api_key",
          "X-Label": "public"
        }
      });
    });

    it("migrates a plain-text secret stdio env value to the encrypted store", async () => {
      const stdioSpec = {
        transport: "stdio" as const,
        command: "node",
        env: { SERVICE_ROLE_KEY: "shh", NODE_ENV: "production" }
      };

      await invokeHandler(IPC.UPDATE_SERVER, "my-server", stdioSpec);

      expect(secretsSetSecretMock).toHaveBeenCalledWith("auth_my-server_env_service_role_key", "shh");
      expect(updateServerMock).toHaveBeenCalledWith(fakeConfig, "my-server", {
        ...stdioSpec,
        env: {
          SERVICE_ROLE_KEY: "secret://auth_my-server_env_service_role_key",
          NODE_ENV: "production"
        }
      });
    });

    it("reuses an existing stored secret without overwriting it", async () => {
      secretsGetSecretMock.mockReturnValue("already stored");
      const httpSpec = {
        transport: "http" as const,
        url: "https://example.com/mcp",
        headers: { API_KEY: "new plain-text value" }
      };

      await invokeHandler(IPC.UPDATE_SERVER, "my-server", httpSpec);

      expect(secretsSetSecretMock).not.toHaveBeenCalled();
      expect(updateServerMock).toHaveBeenCalledWith(fakeConfig, "my-server", {
        ...httpSpec,
        headers: { API_KEY: "secret://auth_my-server_header_api_key" }
      });
    });

    it("leaves empty, referenced, and non-secret values unchanged", async () => {
      const httpSpec = {
        transport: "http" as const,
        url: "https://example.com/mcp",
        headers: {
          TOKEN: "secret://existing_token",
          PASSWORD: "",
          "X-Label": "public"
        }
      };

      await invokeHandler(IPC.UPDATE_SERVER, "my-server", httpSpec);

      expect(secretsGetSecretMock).not.toHaveBeenCalled();
      expect(secretsSetSecretMock).not.toHaveBeenCalled();
      expect(updateServerMock).toHaveBeenCalledWith(fakeConfig, "my-server", httpSpec);
    });

    it("rejects when updateServer rejects (e.g. server does not exist)", async () => {
      updateServerMock.mockImplementation(() => {
        throw new Error('Server "my-server" does not exist.');
      });

      await expect(invokeHandler(IPC.UPDATE_SERVER, "my-server", spec)).rejects.toThrow("does not exist");
    });
  });

  // ---------------------------------------------------------------------------
  describe("REMOVE_SERVER", () => {
    it("removes through mutateConfig with threaded-through args and returns the sync summary", async () => {
      const result = await invokeHandler(IPC.REMOVE_SERVER, "my-server");

      expect(mutateConfigMock).toHaveBeenCalled();
      expect(removeServerMock).toHaveBeenCalledWith(fakeConfig, "my-server", false);
      expect(result).toEqual({ removed: "my-server", sync: fakeSyncSummary });
    });

    it("rejects when removeServer rejects (e.g. server does not exist)", async () => {
      removeServerMock.mockImplementation(() => {
        throw new Error('Server "my-server" does not exist.');
      });

      await expect(invokeHandler(IPC.REMOVE_SERVER, "my-server")).rejects.toThrow("does not exist");
    });
  });

  // ---------------------------------------------------------------------------
  describe("SET_SERVER_ENABLED", () => {
    it("toggles through mutateConfig with threaded-through args and returns the sync summary", async () => {
      const result = await invokeHandler(IPC.SET_SERVER_ENABLED, "my-server", false);

      expect(mutateConfigMock).toHaveBeenCalled();
      expect(setServerEnabledMock).toHaveBeenCalledWith(fakeConfig, "my-server", false);
      expect(result).toEqual({ updated: "my-server", enabled: false, sync: fakeSyncSummary });
    });

    it("rejects when setServerEnabled rejects (e.g. server does not exist)", async () => {
      setServerEnabledMock.mockImplementation(() => {
        throw new Error('Server "my-server" does not exist.');
      });

      await expect(invokeHandler(IPC.SET_SERVER_ENABLED, "my-server", true)).rejects.toThrow("does not exist");
    });
  });

  // ---------------------------------------------------------------------------
  describe("CONFIGURE_AUTH", () => {
    const authArgs = {
      serverName: "my-server",
      headerName: "Authorization",
      authValue: "token123",
      secretName: "custom_secret"
    };

    beforeEach(() => {
      fakeConfig.servers = {
        "my-server": { transport: "http", url: "https://example.com/mcp" }
      };
    });

    it("applies the auth reference through mutateConfig and dismisses pending auth", async () => {
      const result = await invokeHandler(IPC.CONFIGURE_AUTH, authArgs);

      expect(mutateConfigMock).toHaveBeenCalled();
      expect(applyAuthReferenceMock).toHaveBeenCalledWith(
        fakeConfig.servers["my-server"],
        { kind: "header", key: "Authorization" },
        "secret://custom_secret"
      );
      expect(dismissPendingAuthMock).toHaveBeenCalledWith("my-server");
      expect(result).toEqual({ configured: true, sync: fakeSyncSummary });
    });

    it("rejects when the named server does not exist", async () => {
      fakeConfig.servers = {};

      await expect(invokeHandler(IPC.CONFIGURE_AUTH, authArgs)).rejects.toThrow('Server "my-server" not found');
    });
  });

  // ---------------------------------------------------------------------------
  describe("SYNC_ALL", () => {
    it("syncs the loaded config, persists sync state through mutateConfig, and returns the summary", async () => {
      const result = await invokeHandler(IPC.SYNC_ALL);

      expect(syncAllClientsMock).toHaveBeenCalledWith(fakeConfig, expect.any(MockSecretsManager));
      expect(mutateConfigMock).toHaveBeenCalled();
      expect(result).toBe(fakeSyncSummary);
    });

    it("rejects when syncAllClients throws", async () => {
      syncAllClientsMock.mockImplementation(() => {
        throw new Error("sync boom");
      });

      await expect(invokeHandler(IPC.SYNC_ALL)).rejects.toThrow("sync boom");
    });
  });

  // ---------------------------------------------------------------------------
  describe("EXECUTE_CLI_COMMAND", () => {
    it("parses the command, adds the server through mutateConfig, and returns the sync summary", async () => {
      const spec = { transport: "stdio" as const, command: "node", args: ["server.js"] };
      parseCliAddCommandMock.mockReturnValue({ name: "parsed-server", spec });

      const result = await invokeHandler(IPC.EXECUTE_CLI_COMMAND, "mcpx add parsed-server -- node server.js");

      expect(mutateConfigMock).toHaveBeenCalled();
      expect(addServerMock).toHaveBeenCalledWith(fakeConfig, "parsed-server", spec, true);
      expect(result).toEqual({ added: "parsed-server", sync: fakeSyncSummary });
    });

    it("wraps parse failures in a 'Failed to parse command' error", async () => {
      parseCliAddCommandMock.mockImplementation(() => {
        throw new Error("unrecognized flag --nope");
      });

      await expect(invokeHandler(IPC.EXECUTE_CLI_COMMAND, "mcpx add --nope")).rejects.toThrow(
        "Failed to parse command: unrecognized flag --nope"
      );
    });

    it("propagates downstream (non-parse) failures without the parse-error label", async () => {
      // parseCliAddCommand succeeds; the failure happens afterwards inside
      // mutateConfig. Only genuine parse failures get the
      // "Failed to parse command" prefix.
      addServerMock.mockImplementation(() => {
        throw new Error("already exists");
      });

      const rejection = invokeHandler(IPC.EXECUTE_CLI_COMMAND, "mcpx add dup");
      await expect(rejection).rejects.toThrow("already exists");
      await expect(rejection).rejects.not.toThrow("Failed to parse command");
    });
  });
});
