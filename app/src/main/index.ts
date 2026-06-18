import { app, crashReporter, dialog, Menu } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  loadConfig,
  startDaemon,
  stopDaemon,
  getDaemonStatus,
  SecretsManager
} from "@mcpx/core";
import { createTray, setStartDaemonHandler, setStopDaemonHandler, updateTrayForDaemonStatus } from "./tray";
import { buildApplicationMenu } from "./menu";
import { openDashboard } from "./dashboard";
import { registerIpcHandlers } from "./ipc-handlers";
import { runDaemonChildIfRequested } from "./daemon-child";
import { showPopover } from "./popover";
import { loadDesktopSettings } from "./settings-store";
import { applyStartOnLoginSetting, wasOpenedAtLogin } from "./login-item";
import { setAutoUpdateEnabled } from "./update-manager";
import { getDesktopProductName, isDevDesktopApp } from "./app-flavor";
import { resolveLoginShellPath } from "./shell-env";
import { hideDashboard } from "./app-control";

let daemonRunning = false;

/**
 * Register macOS/Linux lifecycle event handlers.
 * Extracted into a separate function for testability.
 */
export function registerLifecycleHandlers(deps: {
  app: typeof import("electron").app;
  openDashboard: () => void;
  hideDashboard: () => void;
}): void {
  deps.app.on("window-all-closed", () => {
    if (process.platform === "win32") {
      deps.app.quit();
    } else if (process.platform === "linux" && !process.env.MCPX_ENABLE_TRAY) {
      deps.app.quit();
    }
  });

  deps.app.on("activate", () => {
    deps.openDashboard();
  });
}

function getCliDaemonPath(): string {
  const resourcesPath = process.resourcesPath ?? app.getAppPath();
  const cliPath = path.join(resourcesPath, "cli", "dist", "cli.js");
  if (fs.existsSync(cliPath)) {
    return cliPath;
  }
  // Fallback for development
  return path.join(app.getAppPath(), "..", "cli", "dist", "cli.js");
}

async function maybeStartDaemonForLoginLaunch(): Promise<void> {
  const settings = loadDesktopSettings();
  if (!settings.startOnLoginEnabled || !wasOpenedAtLogin()) {
    return;
  }

  const config = loadConfig();
  const secrets = new SecretsManager();
  await startDaemon(config, getCliDaemonPath(), secrets);
  daemonRunning = true;
  updateTrayForDaemonStatus(true);
}

async function handleStartDaemon(): Promise<void> {
  try {
    const config = loadConfig();
    const secrets = new SecretsManager();
    await startDaemon(config, getCliDaemonPath(), secrets);
    daemonRunning = true;
    updateTrayForDaemonStatus(true);
  } catch (error) {
    console.error("[main] failed to start daemon:", error);
  }
}

async function handleStopDaemon(): Promise<void> {
  try {
    await stopDaemon();
    daemonRunning = false;
    updateTrayForDaemonStatus(false);
  } catch (error) {
    console.error("[main] failed to stop daemon:", error);
  }
}

function handleStartupError(error: unknown): void {
  const productName = getDesktopProductName();
  console.error("[main] startup failed:", error);
  dialog.showErrorBox(
    "Startup Error",
    `${productName} failed to start: ${error instanceof Error ? error.message : String(error)}`
  );
  app.exit(1);
}

async function startMainProcessImpl(): Promise<void> {
  const productName = getDesktopProductName();

  // Initialize crash reporter BEFORE any Electron API calls
  crashReporter.start({
    productName,
    uploadToServer: false,
  });

  if (await runDaemonChildIfRequested()) {
    return;
  }

  if (process.platform === "darwin") {
    app.setActivationPolicy("regular");
    app.dock?.hide();
  }

  const loginShellPath = await resolveLoginShellPath();
  if (loginShellPath) {
    process.env.PATH = loginShellPath;
  }

  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
    return;
  }

  // Second-instance: on Linux/Windows, open the dashboard; on macOS, do nothing (tray already visible)
  app.on("second-instance", () => {
    if (process.platform !== "darwin") {
      openDashboard();
    }
  });

  await app.whenReady();

  // On Linux, don't use the macOS-style application menu — rely on tray context menu
  if (process.platform !== "linux") {
    Menu.setApplicationMenu(buildApplicationMenu());
  }

  const settings = loadDesktopSettings();
  applyStartOnLoginSetting(settings.startOnLoginEnabled);
  setAutoUpdateEnabled(settings.autoUpdateEnabled);

  // Create tray (starts with daemon stopped)
  const tray = createTray();
  updateTrayForDaemonStatus(false);

  if (isDevDesktopApp()) {
    showPopover(tray);
  }

  // Register IPC handlers
  registerIpcHandlers();

  // Set up daemon start/stop handlers from tray
  setStartDaemonHandler(() => {
    void handleStartDaemon();
  });
  setStopDaemonHandler(() => {
    void handleStopDaemon();
  });

  // ============================================================================
  // Lifecycle Handlers
  // ============================================================================
  registerLifecycleHandlers({ app, openDashboard, hideDashboard });
  // ============================================================================

  // Check daemon status on startup and auto-start if needed
  try {
    const config = loadConfig();
    const status = getDaemonStatus(config);
    daemonRunning = status.running;
    updateTrayForDaemonStatus(daemonRunning);
    
    if (!daemonRunning && config.gateway.autoStart) {
      const secrets = new SecretsManager();
      await startDaemon(config, getCliDaemonPath(), secrets);
      daemonRunning = true;
      updateTrayForDaemonStatus(true);
    } else if (wasOpenedAtLogin()) {
      await maybeStartDaemonForLoginLaunch();
    }
  } catch (error) {
    console.error("[main] failed to check daemon status:", error);
  }
}

export async function startMainProcess(): Promise<void> {
  try {
    await startMainProcessImpl();
  } catch (error) {
    handleStartupError(error);
    throw error;
  }
}

if (process.env.VITEST !== "true") {
  void startMainProcess().catch(() => {
    // startMainProcess already reports startup failures.
  });
}
