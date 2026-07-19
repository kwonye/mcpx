import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { registerLifecycleHandlers } from "../../src/main/index";

vi.mock("@mcpx/core", () => ({
  loadConfig: vi.fn(),
  startDaemon: vi.fn(),
  stopDaemon: vi.fn(),
  getDaemonStatus: vi.fn(() => ({ running: false })),
  SecretsManager: vi.fn(),
  startMarketplaceAutoUpdater: vi.fn(),
}));

function withPlatform(platform: NodeJS.Platform, run: () => void): void {
  const original = process.platform;
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
    writable: true,
  });
  try {
    run();
  } finally {
    Object.defineProperty(process, "platform", {
      value: original,
      configurable: true,
      writable: true,
    });
  }
}

function registerHandlers() {
  const handlers: Record<string, () => void> = {};
  const mockApp = {
    on: vi.fn((event: string, handler: () => void) => {
      handlers[event] = handler;
    }),
    quit: vi.fn(),
  };
  const openDashboard = vi.fn();
  const hideDashboard = vi.fn();

  registerLifecycleHandlers({
    app: mockApp as never,
    openDashboard,
    hideDashboard,
  });

  return { handlers, mockApp, openDashboard, hideDashboard };
}

describe("lifecycle handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses regular activation policy on macOS (Dock app + menubar)", async () => {
    const source = await readFile(join(__dirname, "../../src/main/index.ts"), "utf-8");

    expect(source).toContain('app.setActivationPolicy("regular")');
    // Dock icon visible — no app.dock?.hide()
    expect(source).not.toContain("app.dock?.hide()");
  });

  it("marks the packaged app as a UI element", async () => {
    const packageJson = await readFile(join(__dirname, "../../package.json"), "utf-8");

    expect(packageJson).toContain('"LSUIElement": true');
  });

  it("keeps running when all windows close on macOS", () => {
    withPlatform("darwin", () => {
      const { handlers, mockApp } = registerHandlers();

      handlers["window-all-closed"]?.();

      expect(mockApp.quit).not.toHaveBeenCalled();
    });
  });

  it("quits when all windows close on Windows", () => {
    withPlatform("win32", () => {
      const { handlers, mockApp } = registerHandlers();

      handlers["window-all-closed"]?.();

      expect(mockApp.quit).toHaveBeenCalled();
    });
  });

  it("opens the dashboard on activate", () => {
    const { handlers, openDashboard } = registerHandlers();

    handlers.activate?.();

    expect(openDashboard).toHaveBeenCalled();
  });
});
