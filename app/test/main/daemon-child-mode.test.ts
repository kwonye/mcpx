// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("daemon child mode", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.MCPX_DAEMON_CHILD;
  });

  afterEach(() => {
    delete process.env.MCPX_DAEMON_CHILD;
  });

  it("runs daemon foreground path when child flag is present", async () => {
    const config = {
      gateway: { port: 37373 }
    };
    const loadConfigMock = vi.fn().mockReturnValue(config);
    const runDaemonForegroundMock = vi.fn().mockResolvedValue(undefined);
    class MockSecretsManager {
      marker = "secrets";
    }

    vi.doMock("@mcpx/core", () => ({
      loadConfig: loadConfigMock,
      runDaemonForeground: runDaemonForegroundMock,
      SecretsManager: MockSecretsManager
    }));

    process.env.MCPX_DAEMON_CHILD = "1";

    const { runDaemonChildIfRequested } = await import("../../src/main/daemon-child");
    const handled = await runDaemonChildIfRequested([
      "electron",
      "main.js",
      "daemon",
      "run",
      "--port",
      "43111"
    ]);

    expect(handled).toBe(true);
    expect(loadConfigMock).toHaveBeenCalledTimes(1);
    expect(runDaemonForegroundMock).toHaveBeenCalledTimes(1);
    expect(runDaemonForegroundMock).toHaveBeenCalledWith(config, 43111, expect.any(Object));
  });

  it("skips desktop bootstrap when daemon-child execution is requested", async () => {
    const runDaemonChildIfRequestedMock = vi.fn().mockResolvedValue(true);
    const whenReadyMock = vi.fn().mockResolvedValue(undefined);
    const hideDockMock = vi.fn();
    const registerIpcHandlersMock = vi.fn();
    const createTrayMock = vi.fn();

    process.env.VITEST = "true";

    vi.doMock("electron", () => ({
      app: {
        dock: { hide: hideDockMock },
        whenReady: whenReadyMock,
        getAppPath: () => "/tmp/app",
        exit: vi.fn()
      }
    }));
    vi.doMock("../../src/main/daemon-child", () => ({
      runDaemonChildIfRequested: runDaemonChildIfRequestedMock
    }));
    vi.doMock("../../src/main/ipc-handlers", () => ({
      registerIpcHandlers: registerIpcHandlersMock
    }));
    vi.doMock("../../src/main/tray", () => ({
      createTray: createTrayMock
    }));
    vi.doMock("../../src/main/settings-store", () => ({
      loadDesktopSettings: vi.fn()
    }));
    vi.doMock("../../src/main/login-item", () => ({
      applyStartOnLoginSetting: vi.fn(),
      wasOpenedAtLogin: vi.fn()
    }));
    vi.doMock("../../src/main/update-manager", () => ({
      setAutoUpdateEnabled: vi.fn()
    }));
    vi.doMock("@mcpx/core", () => ({
      loadConfig: vi.fn(),
      startDaemon: vi.fn(),
      SecretsManager: vi.fn()
    }));

    const { startMainProcess } = await import("../../src/main/index");
    await startMainProcess();

    expect(runDaemonChildIfRequestedMock).toHaveBeenCalledTimes(1);
    expect(hideDockMock).not.toHaveBeenCalled();
    expect(whenReadyMock).not.toHaveBeenCalled();
    expect(registerIpcHandlersMock).not.toHaveBeenCalled();
    expect(createTrayMock).not.toHaveBeenCalled();
  });
});
