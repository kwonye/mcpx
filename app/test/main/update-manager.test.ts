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
  isPackaged: true,
  getName: vi.fn().mockReturnValue("mcpx")
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
    vi.doUnmock("../../src/shared/build-constants");
    appMock.isPackaged = true;
    appMock.getName.mockReturnValue("mcpx");
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

  it("runs the coordinated quit preparation before quitAndInstall", async () => {
    const { setAutoUpdateEnabled, setBeforeQuitAndInstall } = await import("../../src/main/update-manager");
    const { autoUpdater } = await import("electron-updater");
    const order: string[] = [];
    const prepare = vi.fn(() => order.push("prepare"));
    vi.mocked(autoUpdater.quitAndInstall).mockImplementation(() => {
      order.push("install");
    });
    showMessageBoxMock.mockResolvedValue({ response: 0 });
    setBeforeQuitAndInstall(prepare);

    setAutoUpdateEnabled(true);
    triggerEvent("update-downloaded", { version: "2.0.0" });
    await vi.waitFor(() => expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1));

    expect(order).toEqual(["prepare", "install"]);
  });

  it("maps updater outcomes to manual check statuses", async () => {
    const { updateCheckResult } = await import("../../src/main/update-manager");

    expect(updateCheckResult("update-available", "1.2.3").status).toBe("available");
    expect(updateCheckResult("update-not-available").status).toBe("up-to-date");
    expect(updateCheckResult("update-downloaded", "1.2.3")).toEqual({
      status: "downloaded",
      message: "Update 1.2.3 is ready. Restart to install it."
    });
  });

  it("reports a downloaded update on later manual checks without re-checking", async () => {
    const { checkForUpdatesNow } = await import("../../src/main/update-manager");

    const first = checkForUpdatesNow();
    triggerEvent("update-available", { version: "1.2.3" });
    await first;
    triggerEvent("update-downloaded", { version: "1.2.3" });

    await expect(checkForUpdatesNow()).resolves.toEqual({
      status: "downloaded",
      message: "Update 1.2.3 is ready. Restart to install it."
    });
    expect(checkForUpdatesMock).toHaveBeenCalledTimes(1);
  });

  it("returns a manual check message when an update is found", async () => {
    const { checkForUpdatesNow } = await import("../../src/main/update-manager");

    const resultPromise = checkForUpdatesNow();
    triggerEvent("update-available", { version: "1.2.3" });

    const result = await resultPromise;

    expect(result).toEqual({
      status: "available",
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
      status: "up-to-date",
      message: "You're already on the latest version."
    });
  });

  it("shares one pending manual check between concurrent callers", async () => {
    const { checkForUpdatesNow } = await import("../../src/main/update-manager");

    const first = checkForUpdatesNow();
    const second = checkForUpdatesNow();
    expect(first).toBe(second);
    triggerEvent("update-not-available");

    await expect(first).resolves.toEqual({
      status: "up-to-date",
      message: "You're already on the latest version."
    });
  });

  it("converts a rejected updater promise into a settled manual result", async () => {
    checkForUpdatesMock.mockRejectedValueOnce(new Error("network unavailable"));
    const { checkForUpdatesNow } = await import("../../src/main/update-manager");

    await expect(checkForUpdatesNow()).resolves.toEqual({
      status: "error",
      message: "Update check failed: network unavailable"
    });
  });

  it("clears the completed check timeout before a later check starts", async () => {
    const { checkForUpdatesNow } = await import("../../src/main/update-manager");

    const first = checkForUpdatesNow();
    triggerEvent("update-not-available");
    await first;

    await vi.advanceTimersByTimeAsync(20_000);
    const second = checkForUpdatesNow();
    let settled = false;
    void second.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(settled).toBe(false);

    triggerEvent("update-not-available");
    await expect(second).resolves.toEqual({
      status: "up-to-date",
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

  it("does not schedule checks for dev app builds", async () => {
    vi.doMock("../../src/shared/build-constants", () => ({
      DESKTOP_BUILD_FLAVOR: "dev",
      DESKTOP_PRODUCT_NAME: "mcpx-dev",
      DESKTOP_DEBUG: true,
      DESKTOP_MANAGER_NAME: "mcpx-dev Manager"
    }));
    const { setAutoUpdateEnabled } = await import("../../src/main/update-manager");

    setAutoUpdateEnabled(true);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

    expect(checkForUpdatesMock).not.toHaveBeenCalled();
  });

  it("returns unsupported status for dev app manual checks", async () => {
    vi.doMock("../../src/shared/build-constants", () => ({
      DESKTOP_BUILD_FLAVOR: "dev",
      DESKTOP_PRODUCT_NAME: "mcpx-dev",
      DESKTOP_DEBUG: true,
      DESKTOP_MANAGER_NAME: "mcpx-dev Manager"
    }));
    const { checkForUpdatesNow } = await import("../../src/main/update-manager");

    const result = await checkForUpdatesNow();

    expect(result).toEqual({
      status: "unsupported",
      message: "Updates are disabled for mcpx-dev builds."
    });
  });
});
