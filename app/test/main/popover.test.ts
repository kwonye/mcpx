// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("popover window behavior", () => {
  const browserWindowInstances: MockBrowserWindow[] = [];

  class MockBrowserWindow {
    handlers: Record<string, () => void> = {};
    visible = false;
    destroyed = false;
    bounds = { x: 10, y: 20, width: 360, height: 320 };
    loadURL = vi.fn();
    loadFile = vi.fn();
    show = vi.fn(() => {
      this.visible = true;
    });
    hide = vi.fn(() => {
      this.visible = false;
    });
    focus = vi.fn();
    setPosition = vi.fn();
    getBounds = vi.fn(() => this.bounds);
    isVisible = vi.fn(() => this.visible);
    isDestroyed = vi.fn(() => this.destroyed);

    on(event: string, handler: () => void): this {
      this.handlers[event] = handler;
      return this;
    }
  }

  const browserWindowConstructor = vi.fn();

  class BrowserWindowMock {
    constructor(..._args: unknown[]) {
      browserWindowConstructor(..._args);
      const window = new MockBrowserWindow();
      browserWindowInstances.push(window);
      return window;
    }
  }

  const screenMock = {
    getDisplayMatching: vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1440, height: 900 }
    }))
  };

  const trayMock = {
    getBounds: vi.fn(() => ({ x: 100, y: 0, width: 24, height: 24 }))
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    browserWindowInstances.length = 0;

    vi.doMock("electron", () => ({
      BrowserWindow: BrowserWindowMock,
      screen: screenMock
    }));
  });

  it("creates the popover on first toggle and reuses it on subsequent toggles", async () => {
    const { togglePopover } = await import("../../src/main/popover");

    const first = togglePopover(trayMock as never) as unknown as MockBrowserWindow;
    expect(browserWindowConstructor).toHaveBeenCalledTimes(1);
    expect(first.show).toHaveBeenCalledTimes(1);
    expect(first.focus).toHaveBeenCalledTimes(1);
    expect(first.setPosition).toHaveBeenCalled();

    togglePopover(trayMock as never);
    expect(first.hide).toHaveBeenCalledTimes(1);
    expect(browserWindowConstructor).toHaveBeenCalledTimes(1);

    first.visible = false;
    togglePopover(trayMock as never);
    expect(first.show).toHaveBeenCalledTimes(2);
    expect(browserWindowConstructor).toHaveBeenCalledTimes(1);
  });

  it("hides the popover when it loses focus", async () => {
    const { togglePopover } = await import("../../src/main/popover");
    const window = togglePopover(trayMock as never) as unknown as MockBrowserWindow;

    window.handlers.blur();
    expect(window.hide).toHaveBeenCalledTimes(1);
  });
});
