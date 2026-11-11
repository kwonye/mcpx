import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

vi.mock("electron", () => ({
  app: {},
  crashReporter: { start: vi.fn() },
  dialog: { showErrorBox: vi.fn() },
  Menu: { setApplicationMenu: vi.fn() },
}));

import { registerLifecycleHandlers } from "../../src/main/index";
import {
  dashboardCloseAction,
  isCliUpdateChildLaunch,
  shouldOpenDashboardAtLaunch,
  shouldRevealOnSecondInstance,
  windowAllClosedAction
} from "../../src/main/platform/lifecycle";
import { isHiddenLaunch } from "../../src/main/platform/autostart";
import { parseDbusBooleanReply, probeLinuxTrayHost } from "../../src/main/platform/linux-tray";

vi.mock("@mcpx/core", () => ({
  loadConfig: vi.fn(),
  startDaemon: vi.fn(),
  stopDaemon: vi.fn(),
  getDaemonStatus: vi.fn(() => ({ running: false })),
  SecretsManager: vi.fn(),
  startMarketplaceAutoUpdater: vi.fn(),
}));

function registerHandlers(trayAvailable: boolean) {
  const handlers: Record<string, () => void> = {};
  const mockApp = {
    on: vi.fn((event: string, handler: () => void) => {
      handlers[event] = handler;
    }),
    quit: vi.fn(),
  };
  const openDashboard = vi.fn();
  const markQuitting = vi.fn();

  registerLifecycleHandlers({
    app: mockApp as never,
    openDashboard,
    isTrayAvailable: () => trayAvailable,
    markQuitting,
  });

  return { handlers, mockApp, openDashboard, markQuitting };
}

describe("lifecycle handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps running when all windows close while the tray exists (every OS)", () => {
    const { handlers, mockApp } = registerHandlers(true);

    handlers["window-all-closed"]?.();

    expect(mockApp.quit).not.toHaveBeenCalled();
  });

  it("quits when all windows close and there is no tray (Linux without a StatusNotifier host)", () => {
    const { handlers, mockApp } = registerHandlers(false);

    handlers["window-all-closed"]?.();

    expect(mockApp.quit).toHaveBeenCalledTimes(1);
  });

  it("marks the app as quitting on before-quit so the dashboard stops hiding on close", () => {
    const { handlers, markQuitting } = registerHandlers(true);

    handlers["before-quit"]?.();

    expect(markQuitting).toHaveBeenCalledTimes(1);
  });

  it("opens the dashboard on activate", () => {
    const { handlers, openDashboard } = registerHandlers(true);

    handlers.activate?.();

    expect(openDashboard).toHaveBeenCalled();
  });

  it("keeps the packaged macOS app a UI element; the Dock icon follows the dashboard", async () => {
    const packageJson = await readFile(join(__dirname, "../../package.json"), "utf-8");
    const appControl = await readFile(join(__dirname, "../../src/main/app-control.ts"), "utf-8");

    expect(packageJson).toContain('"LSUIElement": true');
    expect(appControl).toContain('app.setActivationPolicy(visible ? "regular" : "accessory")');
  });

  it("never stops the gateway on quit", async () => {
    const appControl = await readFile(join(__dirname, "../../src/main/app-control.ts"), "utf-8");

    expect(appControl).not.toContain("stopDaemon");
  });
});

describe("lifecycle decisions", () => {
  it("opens the dashboard on a normal launch", () => {
    expect(shouldOpenDashboardAtLaunch({ hiddenLaunch: false, trayAvailable: true })).toBe(true);
  });

  it("starts hidden in the tray on a login launch", () => {
    expect(shouldOpenDashboardAtLaunch({ hiddenLaunch: true, trayAvailable: true })).toBe(false);
  });

  it("always opens the dashboard when there is no tray, even on a login launch", () => {
    expect(shouldOpenDashboardAtLaunch({ hiddenLaunch: true, trayAvailable: false })).toBe(true);
  });

  it("hides the dashboard on close while the tray exists and the app is not quitting", () => {
    expect(dashboardCloseAction({ quitting: false, trayAvailable: true })).toBe("hide");
  });

  it("really closes the dashboard while quitting", () => {
    expect(dashboardCloseAction({ quitting: true, trayAvailable: true })).toBe("close");
  });

  it("really closes the dashboard when there is no tray", () => {
    expect(dashboardCloseAction({ quitting: false, trayAvailable: false })).toBe("close");
  });

  it("decides window-all-closed from tray availability", () => {
    expect(windowAllClosedAction({ trayAvailable: true })).toBe("stay");
    expect(windowAllClosedAction({ trayAvailable: false })).toBe("quit");
  });

  it("detects hidden launches from --hidden on every OS and from the macOS login item", () => {
    expect(isHiddenLaunch(["C:\\mcpx\\mcpx.exe", "--hidden"], false)).toBe(true);
    expect(isHiddenLaunch(["/opt/mcpx/mcpx", "--autostart"], false)).toBe(true);
    expect(isHiddenLaunch(["/Applications/mcpx.app/Contents/MacOS/mcpx"], true)).toBe(true);
    expect(isHiddenLaunch(["/opt/mcpx/mcpx"], false)).toBe(false);
  });

  it("reveals the dashboard on a second launch unless it is an autostart launch", () => {
    expect(shouldRevealOnSecondInstance(["mcpx"])).toBe(true);
    expect(shouldRevealOnSecondInstance(["mcpx", "--hidden"])).toBe(false);
  });

  it("recognises core's background CLI updater relaunch", () => {
    expect(isCliUpdateChildLaunch({ MCPX_UPDATE_CHILD: "1" })).toBe(true);
    expect(isCliUpdateChildLaunch({})).toBe(false);
  });
});

describe("Linux tray host detection", () => {
  it("parses the StatusNotifierWatcher reply", () => {
    expect(parseDbusBooleanReply("method return time=1 sender=:1.2\n   variant       boolean true\n")).toBe(true);
    expect(parseDbusBooleanReply("method return\n   variant       boolean false\n")).toBe(false);
    expect(parseDbusBooleanReply("")).toBe(false);
  });

  it("reports no host when dbus-send fails or is missing", async () => {
    await expect(
      probeLinuxTrayHost((_file, _args, _opts, cb) => cb(new Error("ServiceUnknown"), ""))
    ).resolves.toBe(false);
    await expect(
      probeLinuxTrayHost(() => {
        throw new Error("ENOENT");
      })
    ).resolves.toBe(false);
  });

  it("reports a host when the watcher says one is registered", async () => {
    await expect(
      probeLinuxTrayHost((_file, _args, _opts, cb) => cb(null, "   variant       boolean true"))
    ).resolves.toBe(true);
  });
});
