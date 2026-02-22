// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateEventHandlers: Record<string, (...args: unknown[]) => void> = {};
const checkForUpdatesMock = vi.fn().mockResolvedValue(undefined);
const quitAndInstallMock = vi.fn();
const onMock = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
  updateEventHandlers[event] = handler;
});
const removeListenerMock = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
  if (updateEventHandlers[event] === handler) {
    delete updateEventHandlers[event];
  }
});
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
    quitAndInstall: quitAndInstallMock,
    on: onMock,
    removeListener: removeListenerMock
  }
}));

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
    const handler = updateEventHandlers["update-downloaded"];
    expect(handler).toBeTypeOf("function");

    await handler();

    expect(showMessageBoxMock).toHaveBeenCalledTimes(1);
    expect(quitAndInstallMock).toHaveBeenCalledTimes(1);
  });
});
