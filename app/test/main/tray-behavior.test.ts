// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import { buildTrayMenuTemplate, trayBehaviorFor, trayIconFile, trayTooltip } from "../../src/main/platform/tray-model";

type Item = MenuItemConstructorOptions;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true, writable: true });
}

const originalPlatform = process.platform;

describe("tray wiring per platform", () => {
  const togglePopoverMock = vi.fn();
  const hidePopoverMock = vi.fn();
  const quitAppMock = vi.fn();
  const openDashboardMock = vi.fn();
  const navigateDashboardMock = vi.fn();
  const trayInstances: MockTray[] = [];
  const createFromPathMock = vi.fn((path: string) => ({ path, setTemplateImage: vi.fn() }));
  let appIsPackaged = false;

  class MockTray {
    handlers: Record<string, (...args: unknown[]) => void> = {};
    setToolTip = vi.fn();
    setContextMenu = vi.fn();
    popUpContextMenu = vi.fn();
    setImage = vi.fn();

    on(event: string, handler: () => void): this {
      this.handlers[event] = handler;
      return this;
    }
  }

  class TrayMock {
    constructor() {
      const tray = new MockTray();
      trayInstances.push(tray);
      return tray;
    }
  }

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    trayInstances.length = 0;
    appIsPackaged = false;

    vi.doMock("electron", () => ({
      Tray: TrayMock,
      nativeImage: { createFromPath: createFromPathMock },
      Menu: { buildFromTemplate: vi.fn((template) => ({ template })) },
      app: {
        get isPackaged() {
          return appIsPackaged;
        }
      }
    }));
    vi.doMock("../../src/main/popover", () => ({
      togglePopover: togglePopoverMock,
      hidePopover: hidePopoverMock
    }));
    vi.doMock("../../src/main/app-control", () => ({ quitApp: quitAppMock }));
    vi.doMock("../../src/main/dashboard", () => ({
      openDashboard: openDashboardMock,
      navigateDashboard: navigateDashboardMock
    }));
  });

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it("macOS: left click toggles the popover, right click pops up the menu, template icons", async () => {
    setPlatform("darwin");
    const { createTray } = await import("../../src/main/tray");
    const tray = createTray() as unknown as MockTray;

    expect(tray.setContextMenu).not.toHaveBeenCalled();
    tray.handlers.click(undefined, { x: 1, y: 2, width: 3, height: 4 });
    expect(togglePopoverMock).toHaveBeenCalledWith(tray, { x: 1, y: 2, width: 3, height: 4 });

    tray.handlers["right-click"]();
    expect(hidePopoverMock).toHaveBeenCalledTimes(1);
    expect(tray.popUpContextMenu).toHaveBeenCalledTimes(1);
    expect(createFromPathMock).toHaveBeenCalledWith(expect.stringContaining("trayIconTemplate-red.png"));
    const icon = createFromPathMock.mock.results[0].value;
    expect(icon.setTemplateImage).toHaveBeenCalledWith(true);

    const menu = tray.popUpContextMenu.mock.calls[0][0] as { template: Item[] };
    menu.template.find((item) => item.label === "Quit mcpx")?.click?.(undefined as never, undefined, undefined as never);
    expect(quitAppMock).toHaveBeenCalledTimes(1);
  });

  it("Windows: state icons, left click popover, right click menu", async () => {
    setPlatform("win32");
    const { createTray, updateTrayForDaemonStatus } = await import("../../src/main/tray");
    const tray = createTray() as unknown as MockTray;

    expect(tray.handlers.click).toBeDefined();
    expect(tray.handlers["right-click"]).toBeDefined();
    expect(tray.setContextMenu).not.toHaveBeenCalled();
    expect(createFromPathMock).toHaveBeenLastCalledWith(expect.stringMatching(/win[\\/]trayIcon-stopped\.png$/));

    updateTrayForDaemonStatus(true);
    expect(createFromPathMock).toHaveBeenLastCalledWith(expect.stringMatching(/win[\\/]trayIcon-running\.png$/));
    expect(tray.setImage).toHaveBeenCalledTimes(1);
  });

  it("Linux: attaches a full context menu and does not rely on click events", async () => {
    setPlatform("linux");
    const { createTray, updateTrayForDaemonStatus } = await import("../../src/main/tray");
    const tray = createTray() as unknown as MockTray;

    expect(tray.handlers.click).toBeUndefined();
    expect(tray.handlers["right-click"]).toBeUndefined();
    expect(tray.setContextMenu).toHaveBeenCalledTimes(1);

    const menu = tray.setContextMenu.mock.calls[0][0] as { template: Item[] };
    expect(menu.template.map((item) => item.label ?? item.type)).toEqual([
      "Open mcpx", "separator", "Gateway: Stopped", "Start Gateway", "separator", "Settings…", "separator", "Quit mcpx"
    ]);

    menu.template.find((item) => item.label === "Open mcpx")?.click?.(undefined as never, undefined, undefined as never);
    menu.template.find((item) => item.label === "Settings…")?.click?.(undefined as never, undefined, undefined as never);
    expect(openDashboardMock).toHaveBeenCalledTimes(1);
    expect(navigateDashboardMock).toHaveBeenCalledWith("settings");

    updateTrayForDaemonStatus(true);
    const updated = tray.setContextMenu.mock.calls[1][0] as { template: Item[] };
    expect(updated.template.map((item) => item.label)).toContain("Stop Gateway");
    expect(updated.template.map((item) => item.label)).toContain("Gateway: Running");
  });

  it("loads packaged tray icons from the unpacked asar (nativeImage cannot read inside app.asar)", async () => {
    setPlatform("darwin");
    appIsPackaged = true;
    const previousResourcesPath = Reflect.get(process, "resourcesPath");
    Reflect.set(process, "resourcesPath", "/Applications/mcpx.app/Contents/Resources");
    try {
      const { createTray } = await import("../../src/main/tray");
      createTray();
      expect(createFromPathMock).toHaveBeenCalled();
      expect(createFromPathMock.mock.calls.every((call) => String(call[0]).includes("app.asar.unpacked"))).toBe(true);
    } finally {
      if (previousResourcesPath === undefined) Reflect.deleteProperty(process, "resourcesPath");
      else Reflect.set(process, "resourcesPath", previousResourcesPath);
    }
  });

  it("updates icon and tooltip when the daemon status changes", async () => {
    setPlatform("darwin");
    const { createTray, updateTrayForDaemonStatus } = await import("../../src/main/tray");
    createTray();

    updateTrayForDaemonStatus(true);
    updateTrayForDaemonStatus(false);

    expect(trayInstances[0]?.setImage).toHaveBeenCalledTimes(2);
    expect(trayInstances[0]?.setToolTip).toHaveBeenLastCalledWith("mcpx - Gateway stopped");
  });
});

describe("tray model", () => {
  it("behaviour per platform", () => {
    expect(trayBehaviorFor("darwin")).toEqual({ clickOpensPopover: true, rightClickOpensMenu: true, attachContextMenu: false, templateImage: true });
    expect(trayBehaviorFor("win32")).toEqual({ clickOpensPopover: true, rightClickOpensMenu: true, attachContextMenu: false, templateImage: false });
    expect(trayBehaviorFor("linux")).toEqual({ clickOpensPopover: false, rightClickOpensMenu: false, attachContextMenu: true, templateImage: false });
  });

  it("icon files per platform, state and flavor", () => {
    expect(trayIconFile("darwin", true, false)).toBe("trayIconTemplate-green.png");
    expect(trayIconFile("darwin", false, true)).toBe("trayIconDevTemplate-red.png");
    expect(trayIconFile("win32", true, false)).toBe("win/trayIcon-running.png");
    expect(trayIconFile("win32", false, true)).toBe("win/trayIcon-stopped.png");
    expect(trayIconFile("linux", true, false)).toBe("linux/tray-icon.png");
  });

  it("tooltip reflects gateway state", () => {
    expect(trayTooltip("mcpx", true)).toBe("mcpx - Gateway running");
    expect(trayTooltip("mcpx", false)).toBe("mcpx - Gateway stopped");
  });

  it("menu: Open, disabled status line, Start/Stop, Settings, Quit", () => {
    const actions = { openDashboard: vi.fn(), startGateway: vi.fn(), stopGateway: vi.fn(), openSettings: vi.fn(), quit: vi.fn() };
    const stopped = buildTrayMenuTemplate("mcpx", false, actions);
    const running = buildTrayMenuTemplate("mcpx", true, actions);

    expect(stopped.find((item) => item.label === "Gateway: Stopped")?.enabled).toBe(false);
    expect(running.find((item) => item.label === "Gateway: Running")?.enabled).toBe(false);

    stopped.find((item) => item.label === "Start Gateway")?.click?.(undefined as never, undefined, undefined as never);
    running.find((item) => item.label === "Stop Gateway")?.click?.(undefined as never, undefined, undefined as never);
    running.find((item) => item.label === "Settings…")?.click?.(undefined as never, undefined, undefined as never);
    running.find((item) => item.label === "Quit mcpx")?.click?.(undefined as never, undefined, undefined as never);
    running.find((item) => item.label === "Open mcpx")?.click?.(undefined as never, undefined, undefined as never);

    expect(actions.startGateway).toHaveBeenCalledTimes(1);
    expect(actions.stopGateway).toHaveBeenCalledTimes(1);
    expect(actions.openSettings).toHaveBeenCalledTimes(1);
    expect(actions.quit).toHaveBeenCalledTimes(1);
    expect(actions.openDashboard).toHaveBeenCalledTimes(1);
  });
});
