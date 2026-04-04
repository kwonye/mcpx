import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerLifecycleHandlers, lifecycleState } from "../../src/main/index";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Mock @mcpx/core to prevent module resolution errors
vi.mock("@mcpx/core", () => ({
  loadConfig: vi.fn(),
  startDaemon: vi.fn(),
  stopDaemon: vi.fn(),
  getDaemonStatus: vi.fn(() => ({ running: false })),
  SecretsManager: vi.fn(),
}));

describe("lifecycle handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset allowQuit to false before each test
    lifecycleState.allowQuit = false;
  });

  describe("dock visibility", () => {
    it("starts the app in accessory mode on macOS", async () => {
      const source = await readFile(
        join(__dirname, "../../src/main/index.ts"),
        "utf-8"
      );

      expect(source).toContain('app.setActivationPolicy("regular")');
      expect(source).toContain("app.dock?.hide()");
    });

    it("marks the packaged app as a UI element so it stays out of the dock", async () => {
      const packageJson = await readFile(
        join(__dirname, "../../package.json"),
        "utf-8"
      );

      expect(packageJson).toContain('"LSUIElement": true');
    });
  });

  describe("window-all-closed", () => {
    it("should not call app.quit() on macOS", () => {
      // Set platform to macOS
      Object.defineProperty(process, "platform", {
        value: "darwin",
        configurable: true,
        writable: true,
      });

      // Create mock handlers record
      const handlers: Record<string, (e?: any) => void> = {};
      const mockApp = {
        on: vi.fn((event: string, handler: (e?: any) => void) => {
          handlers[event] = handler;
        }),
        quit: vi.fn(),
        hide: vi.fn(),
      };
      const mockOpenDashboard = vi.fn();
      const mockCloseDashboard = vi.fn();

      // Register handlers with mocked dependencies
      registerLifecycleHandlers({
        app: mockApp as any,
        openDashboard: mockOpenDashboard,
        closeDashboard: mockCloseDashboard,
      });

      // Trigger the window-all-closed handler
      if (handlers["window-all-closed"]) {
        handlers["window-all-closed"]();
      }

      // Verify app.quit was NOT called on macOS
      expect(mockApp.quit).not.toHaveBeenCalled();
    });

    it("should call app.quit() on non-macOS (linux)", () => {
      // Set platform to linux
      Object.defineProperty(process, "platform", {
        value: "linux",
        configurable: true,
        writable: true,
      });

      // Create mock handlers record
      const handlers: Record<string, (e?: any) => void> = {};
      const mockApp = {
        on: vi.fn((event: string, handler: (e?: any) => void) => {
          handlers[event] = handler;
        }),
        quit: vi.fn(),
        hide: vi.fn(),
      };
      const mockOpenDashboard = vi.fn();
      const mockCloseDashboard = vi.fn();

      // Register handlers with mocked dependencies
      registerLifecycleHandlers({
        app: mockApp as any,
        openDashboard: mockOpenDashboard,
        closeDashboard: mockCloseDashboard,
      });

      // Trigger the window-all-closed handler
      if (handlers["window-all-closed"]) {
        handlers["window-all-closed"]();
      }

      // Verify app.quit WAS called on non-macOS
      expect(mockApp.quit).toHaveBeenCalled();
    });

    it("should call app.quit() on non-macOS (win32)", () => {
      // Set platform to windows
      Object.defineProperty(process, "platform", {
        value: "win32",
        configurable: true,
        writable: true,
      });

      // Create mock handlers record
      const handlers: Record<string, (e?: any) => void> = {};
      const mockApp = {
        on: vi.fn((event: string, handler: (e?: any) => void) => {
          handlers[event] = handler;
        }),
        quit: vi.fn(),
        hide: vi.fn(),
      };
      const mockOpenDashboard = vi.fn();
      const mockCloseDashboard = vi.fn();

      // Register handlers with mocked dependencies
      registerLifecycleHandlers({
        app: mockApp as any,
        openDashboard: mockOpenDashboard,
        closeDashboard: mockCloseDashboard,
      });

      // Trigger the window-all-closed handler
      if (handlers["window-all-closed"]) {
        handlers["window-all-closed"]();
      }

      // Verify app.quit WAS called on Windows
      expect(mockApp.quit).toHaveBeenCalled();
    });
  });

  describe("activate", () => {
    it("should call openDashboard when activated", () => {
      // Create mock handlers record
      const handlers: Record<string, (e?: any) => void> = {};
      const mockApp = {
        on: vi.fn((event: string, handler: (e?: any) => void) => {
          handlers[event] = handler;
        }),
        quit: vi.fn(),
        hide: vi.fn(),
      };
      const mockOpenDashboard = vi.fn();
      const mockCloseDashboard = vi.fn();

      // Register handlers with mocked dependencies
      registerLifecycleHandlers({
        app: mockApp as any,
        openDashboard: mockOpenDashboard,
        closeDashboard: mockCloseDashboard,
      });

      // Trigger the activate handler
      if (handlers["activate"]) {
        handlers["activate"]();
      }

      // Verify openDashboard was called
      expect(mockOpenDashboard).toHaveBeenCalled();
    });

    it("should call openDashboard only once per activate event", () => {
      // Create mock handlers record
      const handlers: Record<string, (e?: any) => void> = {};
      const mockApp = {
        on: vi.fn((event: string, handler: (e?: any) => void) => {
          handlers[event] = handler;
        }),
        quit: vi.fn(),
        hide: vi.fn(),
      };
      const mockOpenDashboard = vi.fn();
      const mockCloseDashboard = vi.fn();

      // Register handlers with mocked dependencies
      registerLifecycleHandlers({
        app: mockApp as any,
        openDashboard: mockOpenDashboard,
        closeDashboard: mockCloseDashboard,
      });

      // Trigger activate multiple times
      if (handlers["activate"]) {
        handlers["activate"]();
        handlers["activate"]();
        handlers["activate"]();
      }

      // Verify openDashboard called once per event (no deduplication)
      expect(mockOpenDashboard).toHaveBeenCalledTimes(3);
    });
  });

  describe("before-quit", () => {
    it("should prevent quit when allowQuit is false", () => {
      // Create mock handlers record
      const handlers: Record<string, (e?: any) => void> = {};
      const mockApp = {
        on: vi.fn((event: string, handler: (e?: any) => void) => {
          handlers[event] = handler;
        }),
        quit: vi.fn(),
        hide: vi.fn(),
      };
      const mockOpenDashboard = vi.fn();
      const mockCloseDashboard = vi.fn();

      // Register handlers with mocked dependencies
      registerLifecycleHandlers({
        app: mockApp as any,
        openDashboard: mockOpenDashboard,
        closeDashboard: mockCloseDashboard,
      });

      // Create a mock event object
      const mockEvent = { preventDefault: vi.fn() };

      // Ensure allowQuit is false
      lifecycleState.allowQuit = false;

      // Trigger before-quit handler with event
      if (handlers["before-quit"]) {
        handlers["before-quit"](mockEvent);
      }

      // Verify preventDefault was called (quit prevented)
      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    it("should allow quit when allowQuit is true", () => {
      // Create mock handlers record
      const handlers: Record<string, (e?: any) => void> = {};
      const mockApp = {
        on: vi.fn((event: string, handler: (e?: any) => void) => {
          handlers[event] = handler;
        }),
        quit: vi.fn(),
        hide: vi.fn(),
      };
      const mockOpenDashboard = vi.fn();
      const mockCloseDashboard = vi.fn();

      // Register handlers with mocked dependencies
      registerLifecycleHandlers({
        app: mockApp as any,
        openDashboard: mockOpenDashboard,
        closeDashboard: mockCloseDashboard,
      });

      // Create a mock event object
      const mockEvent = { preventDefault: vi.fn() };

      // Set allowQuit to true
      lifecycleState.allowQuit = true;

      // Trigger before-quit handler with event
      if (handlers["before-quit"]) {
        handlers["before-quit"](mockEvent);
      }

      // Verify preventDefault was NOT called (quit allowed)
      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
    });
  });
});
