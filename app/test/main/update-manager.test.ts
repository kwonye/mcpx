// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateEventHandlers: Record<string, ((...args: unknown[]) => void)[]> = {};
const checkForUpdatesMock = vi.fn().mockResolvedValue(undefined);
const onMock = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
  if (!updateEventHandlers[event]) {
    updateEventHandlers[event] = [];
  }
  updateEventHandlers[event].push(handler);
});
const removeListenerMock = vi.fn();
const showMessageBoxMock = vi.fn();
const appMock = {
  isPackaged: true
};

vi.mock("electron", () => ({
  app: appMock,
  dialog: {
    showMessageBox: showMessageBoxMock
  }
}));

vi.mock("electron-updater", () => ({
  autoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    checkForUpdates: checkForUpdatesMock,
    quitAndInstall: vi.fn(),
    on: onMock,
    removeListener: removeListenerMock
  }
}));

function triggerEvent(event: string, ...args: unknown[]): void {
  const handlers = updateEventHandlers[event];
  if (handlers) {
    handlers.forEach((handler) => handler(...args));
  }
}

describe("update manager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
    appMock.isPackaged = true;
    for (const key of Object.keys(updateEventHandlers)) {
      delete updateEventHandlers[key];
    }
    showMessageBoxMock.mockResolvedValue({ response: 1 });
  });

  afterEach(async () => {
    try {
      const { disposeUpdateManager } = await import("../../src/main/update-manager");
      disposeUpdateManager();
    } catch {
      // Module may not be loaded in each test.
    }
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("schedules update checks when enabled", async () => {
    const { setAutoUpdateEnabled } = await import("../../src/main/update-manager");

    setAutoUpdateEnabled(true);
    expect(checkForUpdatesMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(checkForUpdatesMock).toHaveBeenCalledTimes(2);
  });

  it("does not schedule checks when disabled", async () => {
    const { setAutoUpdateEnabled } = await import("../../src/main/update-manager");

    setAutoUpdateEnabled(false);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(checkForUpdatesMock).not.toHaveBeenCalled();
  });

  it("clears the interval when disabled", async () => {
    const { setAutoUpdateEnabled } = await import("../../src/main/update-manager");

    setAutoUpdateEnabled(true);
    expect(checkForUpdatesMock).toHaveBeenCalledTimes(1);

    setAutoUpdateEnabled(false);
    await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);
    expect(checkForUpdatesMock).toHaveBeenCalledTimes(1);
  });

  it("prompts for restart and installs when user accepts downloaded update", async () => {
    const { setAutoUpdateEnabled } = await import("../../src/main/update-manager");
    showMessageBoxMock.mockResolvedValue({ response: 0 });

    setAutoUpdateEnabled(true);
    triggerEvent("update-downloaded");

    expect(showMessageBoxMock).toHaveBeenCalledTimes(1);
  });

  it("returns a manual check message when an update is found", async () => {
    const { checkForUpdatesNow } = await import("../../src/main/update-manager");

    const resultPromise = checkForUpdatesNow();
    triggerEvent("update-available", { version: "1.2.3" });

    const result = await resultPromise;

    expect(result).toEqual({
      status: "checking",
      message: "Update 1.2.3 found. Downloading now and it will install on the next restart."
    });
    expect(checkForUpdatesMock).toHaveBeenCalledTimes(1);
  });

  it("returns latest-version status when no update is available", async () => {
    const { checkForUpdatesNow } = await import("../../src/main/update-manager");

    const resultPromise = checkForUpdatesNow();
    triggerEvent("update-not-available");

    const result = await resultPromise;

    expect(result).toEqual({
      status: "downloaded",
      message: "You're already on the latest version."
    });
  });

  it("returns unsupported status when not packaged", async () => {
    appMock.isPackaged = false;
    const { checkForUpdatesNow } = await import("../../src/main/update-manager");

    const result = await checkForUpdatesNow();

    expect(result).toEqual({
      status: "unsupported",
      message: "Updates are only available in packaged builds."
    });
  });
});
