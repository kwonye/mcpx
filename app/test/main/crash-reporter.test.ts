// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("crashReporter initialization", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.VITEST;
  });

  afterEach(() => {
    delete process.env.VITEST;
  });

  it("should call crashReporter.start() before any Electron API calls", async () => {
    const mockCrashReporterStart = vi.fn();
    const mockRequestSingleInstanceLock = vi.fn().mockReturnValue(true);
    const mockWhenReady = vi.fn().mockResolvedValue(undefined);
    const mockAppOn = vi.fn();
    const mockAppQuit = vi.fn();
    const mockAppExit = vi.fn();

    vi.doMock("electron", () => ({
      app: {
        on: mockAppOn,
        quit: mockAppQuit,
        exit: mockAppExit,
        dock: { hide: vi.fn() },
        whenReady: mockWhenReady,
        requestSingleInstanceLock: mockRequestSingleInstanceLock,
        getAppPath: () => "/tmp/app",
      },
      crashReporter: {
        start: mockCrashReporterStart,
      },
      dialog: {
        showErrorBox: vi.fn(),
      },
    }));

    vi.doMock("@mcpx/core", () => ({
      loadConfig: vi.fn(),
      startDaemon: vi.fn(),
      stopDaemon: vi.fn(),
      getDaemonStatus: vi.fn().mockReturnValue({ running: false }),
      SecretsManager: vi.fn(),
    }));

    vi.doMock("../../src/main/tray", () => ({
      createTray: vi.fn(),
      setQuitHandler: vi.fn(),
      setStartDaemonHandler: vi.fn(),
      setStopDaemonHandler: vi.fn(),
      updateTrayForDaemonStatus: vi.fn(),
    }));

    vi.doMock("../../src/main/dashboard", () => ({
      openDashboard: vi.fn(),
      hideDashboard: vi.fn(),
      closeDashboard: vi.fn(),
    }));

    vi.doMock("../../src/main/ipc-handlers", () => ({
      registerIpcHandlers: vi.fn(),
    }));

    vi.doMock("../../src/main/daemon-child", () => ({
      runDaemonChildIfRequested: vi.fn().mockResolvedValue(false),
    }));

    vi.doMock("../../src/main/settings-store", () => ({
      loadDesktopSettings: vi.fn().mockReturnValue({
        startOnLoginEnabled: false,
        autoUpdateEnabled: true,
      }),
    }));

    vi.doMock("../../src/main/login-item", () => ({
      applyStartOnLoginSetting: vi.fn(),
      wasOpenedAtLogin: vi.fn().mockReturnValue(false),
    }));

    vi.doMock("../../src/main/update-manager", () => ({
      setAutoUpdateEnabled: vi.fn(),
    }));

    const { startMainProcess } = await import("../../src/main/index");
    await startMainProcess();

    // crashReporter.start() should be called FIRST, before any other Electron API
    expect(mockCrashReporterStart).toHaveBeenCalledBefore(mockRequestSingleInstanceLock);
    expect(mockCrashReporterStart).toHaveBeenCalledWith({
      productName: "mcpx",
      uploadToServer: false,
    });
  });

  it("should show error dialog and exit on startup failure", async () => {
    const mockShowErrorBox = vi.fn();
    const mockAppExit = vi.fn();
    const startupError = new Error("Test startup error");

    vi.doMock("electron", () => ({
      app: {
        on: vi.fn(),
        quit: vi.fn(),
        exit: mockAppExit,
        dock: { hide: vi.fn() },
        whenReady: vi.fn().mockRejectedValue(startupError),
        requestSingleInstanceLock: vi.fn().mockReturnValue(true),
        getAppPath: () => "/tmp/app",
      },
      crashReporter: {
        start: vi.fn(),
      },
      dialog: {
        showErrorBox: mockShowErrorBox,
      },
    }));

    vi.doMock("@mcpx/core", () => ({
      loadConfig: vi.fn(),
      startDaemon: vi.fn(),
      stopDaemon: vi.fn(),
      getDaemonStatus: vi.fn(),
      SecretsManager: vi.fn(),
    }));

    vi.doMock("../../src/main/tray", () => ({
      createTray: vi.fn(),
      setQuitHandler: vi.fn(),
      setStartDaemonHandler: vi.fn(),
      setStopDaemonHandler: vi.fn(),
      updateTrayForDaemonStatus: vi.fn(),
    }));

    vi.doMock("../../src/main/dashboard", () => ({
      openDashboard: vi.fn(),
      hideDashboard: vi.fn(),
      closeDashboard: vi.fn(),
    }));

    vi.doMock("../../src/main/ipc-handlers", () => ({
      registerIpcHandlers: vi.fn(),
    }));

    vi.doMock("../../src/main/daemon-child", () => ({
      runDaemonChildIfRequested: vi.fn().mockResolvedValue(false),
    }));

    vi.doMock("../../src/main/settings-store", () => ({
      loadDesktopSettings: vi.fn(),
    }));

    vi.doMock("../../src/main/login-item", () => ({
      applyStartOnLoginSetting: vi.fn(),
      wasOpenedAtLogin: vi.fn(),
    }));

    vi.doMock("../../src/main/update-manager", () => ({
      setAutoUpdateEnabled: vi.fn(),
    }));

    const { startMainProcess } = await import("../../src/main/index");
    
    // The error should be caught by the global error handler in index.ts
    // We need to await the promise and catch the error
    await expect(startMainProcess()).rejects.toThrow("Test startup error");

    // Should show error dialog
    expect(mockShowErrorBox).toHaveBeenCalledWith(
      "Startup Error",
      expect.stringContaining("Test startup error")
    );

    // Should exit with code 1
    expect(mockAppExit).toHaveBeenCalledWith(1);
  });
});
