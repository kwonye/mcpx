// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("tray click behavior", () => {
  const togglePopoverMock = vi.fn();
  const hidePopoverMock = vi.fn();
  const quitAppMock = vi.fn();
  const trayInstances: MockTray[] = [];
  const createFromPathMock = vi.fn(() => ({ path: "icon", setTemplateImage: vi.fn() }));
  let appIsPackaged = false;

  class MockTray {
    handlers: Record<string, () => void> = {};
    setToolTip = vi.fn();
    setContextMenu = vi.fn();
    popUpContextMenu = vi.fn();
    setImage = vi.fn();

    on(event: string, handler: () => void): this {
      this.handlers[event] = handler;
      return this;
    }
  }

  const trayConstructor = vi.fn();

  class TrayMock {
    constructor(..._args: unknown[]) {
      trayConstructor(..._args);
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
      nativeImage: {
        createFromPath: createFromPathMock
      },
      Menu: {
        buildFromTemplate: vi.fn((template) => ({ template }))
      },
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

    vi.doMock("../../src/main/app-control", () => ({
      quitApp: quitAppMock
    }));
  });

  it("opens the popover on left click and hides it on right click", async () => {
    const { createTray } = await import("../../src/main/tray");
    const tray = createTray() as unknown as MockTray;

    expect(trayConstructor).toHaveBeenCalledTimes(1);
    expect(tray.setContextMenu).not.toHaveBeenCalled();

    tray.handlers.click();
    expect(togglePopoverMock).toHaveBeenCalledWith(tray, undefined);

    tray.handlers["right-click"]();
    expect(hidePopoverMock).toHaveBeenCalledTimes(1);
    expect(tray.popUpContextMenu).toHaveBeenCalledTimes(1);
    expect(createFromPathMock).toHaveBeenCalledWith(expect.stringContaining(process.platform === "darwin" ? "trayIconTemplate-" : "linux/tray-icon.png"));
    expect(createFromPathMock.mock.calls.every((call) => !String(call[0]).includes("app.asar.unpacked"))).toBe(true);

    const menu = tray.popUpContextMenu.mock.calls[0][0] as { template: Array<{ label: string; click?: () => void }> };
    menu.template.find((item) => item.label === "Quit")?.click?.();
    expect(quitAppMock).toHaveBeenCalledTimes(1);
  });

  it("updates the tray icon when daemon status changes", async () => {
    const { createTray, updateTrayForDaemonStatus } = await import("../../src/main/tray");
    createTray();

    updateTrayForDaemonStatus(true);
    updateTrayForDaemonStatus(false);

    expect(trayInstances[0]?.setImage).toHaveBeenCalledTimes(2);
    expect(trayInstances[0]?.setToolTip).toHaveBeenCalledTimes(3);
  });

  it("loads packaged tray icons from the unpacked asar", async () => {
    appIsPackaged = true;
    const previousResourcesPath = Reflect.get(process, "resourcesPath");
    Reflect.set(process, "resourcesPath", "/Applications/mcpx.app/Contents/Resources");

    try {
      const { createTray } = await import("../../src/main/tray");
      createTray();

      expect(createFromPathMock).toHaveBeenCalled();
      expect(createFromPathMock.mock.calls.every((call) => String(call[0]).includes("app.asar.unpacked"))).toBe(true);
      expect(createFromPathMock).toHaveBeenCalledWith(expect.stringContaining(process.platform === "darwin" ? "trayIconTemplate-" : "linux/tray-icon.png"));
    } finally {
      if (previousResourcesPath === undefined) {
        Reflect.deleteProperty(process, "resourcesPath");
      } else {
        Reflect.set(process, "resourcesPath", previousResourcesPath);
      }
    }
  });
});
