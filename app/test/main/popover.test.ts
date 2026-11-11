// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("popover window behavior", () => {
  const browserWindowInstances: MockBrowserWindow[] = [];

  class MockBrowserWindow {
    handlers: Record<string, () => void> = {};
    webContents = {
      on: vi.fn((event: string, handler: () => void) => {
        this.handlers[event] = handler;
      }),
      isDevToolsOpened: vi.fn(() => false),
      isDevToolsFocused: vi.fn(() => false),
    };
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
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      workArea: { x: 0, y: 25, width: 1440, height: 875 }
    })),
    getCursorScreenPoint: vi.fn(() => ({ x: 700, y: 10 }))
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

  it("positions below a top menu bar icon inside the work area", async () => {
    const { togglePopover } = await import("../../src/main/popover");
    const window = togglePopover(trayMock as never) as unknown as MockBrowserWindow;

    expect(window.setPosition).toHaveBeenCalledWith(8, 33, false);
  });

  it("a tray click that blurred the open popover closes it instead of reopening", async () => {
    const { togglePopover } = await import("../../src/main/popover");
    const window = togglePopover(trayMock as never) as unknown as MockBrowserWindow;

    window.handlers.blur();
    togglePopover(trayMock as never);

    expect(window.show).toHaveBeenCalledTimes(1);
  });

  it("does not use the macOS panel type off macOS", async () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      const { togglePopover } = await import("../../src/main/popover");
      togglePopover(trayMock as never);
      expect(browserWindowConstructor.mock.calls[0][0].type).toBeUndefined();
      expect(browserWindowConstructor.mock.calls[0][0].webPreferences.contextIsolation).toBe(true);
    } finally {
      Object.defineProperty(process, "platform", { value: original, configurable: true });
    }
  });

  it("hides the popover when it loses focus", async () => {
    const { togglePopover } = await import("../../src/main/popover");
    const window = togglePopover(trayMock as never) as unknown as MockBrowserWindow;

    window.handlers.blur();
    expect(window.hide).toHaveBeenCalledTimes(1);
  });
});
