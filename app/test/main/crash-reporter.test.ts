import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Electron app object
const mockApp = {
  on: vi.fn(),
  quit: vi.fn(),
  hide: vi.fn(),
  exit: vi.fn(),
  dock: {
    show: vi.fn(),
    hide: vi.fn(),
  },
  whenReady: vi.fn().mockResolvedValue(undefined),
  requestSingleInstanceLock: vi.fn().mockReturnValue(true),
};

const mockCrashReporter = {
  start: vi.fn(),
};

const mockDialog = {
  showErrorBox: vi.fn(),
};

vi.mock("electron", () => ({
  app: mockApp,
  crashReporter: mockCrashReporter,
  dialog: mockDialog,
}));

describe("crashReporter initialization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module to get fresh imports
    vi.resetModules();
  });

  it("should call crashReporter.start() before any Electron API calls", async () => {
    // Import after mocks are set up
    const { startMainProcess } = await import("../../src/main/index.js");

    await startMainProcess();

    // crashReporter.start() should be called FIRST, before any other Electron API
    expect(mockCrashReporter.start).toHaveBeenCalledBefore(mockApp.requestSingleInstanceLock);
    expect(mockCrashReporter.start).toHaveBeenCalledWith({
      productName: "mcpx",
      uploadToServer: false,
    });
  });

  it("should show error dialog and exit on startup failure", async () => {
    // Simulate a startup error by making whenReady throw
    mockApp.whenReady.mockRejectedValueOnce(new Error("Test startup error"));

    const { startMainProcess } = await import("../../src/main/index.js");

    await startMainProcess();

    // Should show error dialog
    expect(mockDialog.showErrorBox).toHaveBeenCalledWith(
      "Startup Error",
      expect.stringContaining("Test startup error")
    );

    // Should exit with code 1
    expect(mockApp.exit).toHaveBeenCalledWith(1);
  });
});
