// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("tray click behavior", () => {
  const togglePopoverMock = vi.fn();
  const hidePopoverMock = vi.fn();
  const trayInstances: MockTray[] = [];
  const createFromPathMock = vi.fn(() => ({ path: "icon" }));

  class MockTray {
    handlers: Record<string, () => void> = {};
    setToolTip = vi.fn();
    setContextMenu = vi.fn();
    popUpContextMenu = vi.fn();

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

    vi.doMock("electron", () => ({
      Tray: TrayMock,
      nativeImage: {
        createFromPath: createFromPathMock
      },
      Menu: {
        buildFromTemplate: vi.fn((template) => ({ template }))
      },
      app: {}
    }));

    vi.doMock("../../src/main/popover", () => ({
      togglePopover: togglePopoverMock,
      hidePopover: hidePopoverMock
    }));
  });

  it("opens the popover on left click and hides it on right click", async () => {
    const { createTray } = await import("../../src/main/tray");
    const tray = createTray() as unknown as MockTray;

    expect(trayConstructor).toHaveBeenCalledTimes(1);
    expect(tray.setContextMenu).not.toHaveBeenCalled();

    tray.handlers.click();
    expect(togglePopoverMock).toHaveBeenCalledWith(tray);

    tray.handlers["right-click"]();
    expect(hidePopoverMock).toHaveBeenCalledTimes(1);
    expect(tray.popUpContextMenu).toHaveBeenCalledTimes(1);
    expect(createFromPathMock).toHaveBeenCalledWith(expect.stringContaining("trayIconTemplate.png"));
  });

  it("updates the tray menu when daemon status changes", async () => {
    const { createTray, updateTrayForDaemonStatus } = await import("../../src/main/tray");
    createTray();

    updateTrayForDaemonStatus(true);
    updateTrayForDaemonStatus(false);

    expect(trayInstances[0]?.setContextMenu).not.toHaveBeenCalled();
  });
});
