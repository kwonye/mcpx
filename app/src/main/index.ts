import { app } from "electron";
import {
  loadConfig,
  startDaemon,
  stopDaemon,
  getDaemonStatus,
  SecretsManager
} from "@mcpx/core";
import { createTray, setQuitHandler, setStartDaemonHandler, setStopDaemonHandler, updateTrayForDaemonStatus } from "./tray";
import { openDashboard, hideDashboard, closeDashboard } from "./dashboard";
import { registerIpcHandlers } from "./ipc-handlers";
import { runDaemonChildIfRequested } from "./daemon-child";
import { loadDesktopSettings } from "./settings-store";
import { applyStartOnLoginSetting, wasOpenedAtLogin } from "./login-item";
import { setAutoUpdateEnabled } from "./update-manager";

let allowQuit = false;
let daemonRunning = false;

function daemonEntrypointArg(): string {
  return process.argv[1] ?? app.getAppPath();
}

async function maybeStartDaemonForLoginLaunch(): Promise<void> {
  const settings = loadDesktopSettings();
  if (!settings.startOnLoginEnabled || !wasOpenedAtLogin()) {
    return;
  }

  const config = loadConfig();
  const secrets = new SecretsManager();
  await startDaemon(config, daemonEntrypointArg(), secrets);
  daemonRunning = true;
  updateTrayForDaemonStatus(true);
}

async function handleStartDaemon(): Promise<void> {
  try {
    const config = loadConfig();
    const secrets = new SecretsManager();
    await startDaemon(config, daemonEntrypointArg(), secrets);
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

export async function startMainProcess(): Promise<void> {
  if (await runDaemonChildIfRequested()) {
    return;
  }

  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    openDashboard();
  });

  await app.whenReady();

  const settings = loadDesktopSettings();
  applyStartOnLoginSetting(settings.startOnLoginEnabled);
  setAutoUpdateEnabled(settings.autoUpdateEnabled);

  // Create tray (starts with daemon stopped)
  createTray();
  updateTrayForDaemonStatus(false);

  // Register IPC handlers
  registerIpcHandlers();

  // Set up quit handler from tray menu
  setQuitHandler(() => {
    allowQuit = true;
    closeDashboard();
    app.quit();
  });

  // Set up daemon start/stop handlers from tray
  setStartDaemonHandler(() => {
    void handleStartDaemon();
  });
  setStopDaemonHandler(() => {
    void handleStopDaemon();
  });

  // ============================================================================
  // macOS Lifecycle Handlers
  // ============================================================================
  // Cmd+Q quits the entire app (dashboard + daemon + tray)
  // Prevents quit from window close, allows quit only via tray menu (allowQuit flag)
  app.on("before-quit", (e) => {
    if (!allowQuit) {
      e.preventDefault();
      closeDashboard();
      app.hide();
      return;
    }
    // Allow quit to proceed
  });

  // Clicking dock icon reopens dashboard window (macOS activate event)
  // Ensures app responds to dock clicks even when window is closed
  app.on("activate", () => {
    openDashboard();
  });

  // When all windows are closed, app stays running on macOS (menu bar app pattern)
  // Only quits on non-macOS platforms where menu bar is not available
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
  // ============================================================================

  // Check daemon status on startup and auto-start if needed
  try {
    const status = getDaemonStatus();
    daemonRunning = status.running;
    updateTrayForDaemonStatus(daemonRunning);
    
    // Auto-start daemon if it was running before or if login launch
    if (daemonRunning || wasOpenedAtLogin()) {
      await maybeStartDaemonForLoginLaunch();
    }
  } catch (error) {
    console.error("[main] failed to check daemon status:", error);
  }
}

if (process.env.VITEST !== "true") {
  void startMainProcess().catch((error) => {
    console.error("[main] startup failed:", error);
    app.exit(1);
  });
}