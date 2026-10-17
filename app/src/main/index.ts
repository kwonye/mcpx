import { app, dialog, Menu } from "electron";
import {
  loadConfig,
  startDaemon,
  stopDaemon,
  getDaemonStatus,
  SecretsManager,
  startMarketplaceAutoUpdater,
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
import { startErrorNotifier } from "./error-notifier";
import { getDesktopProductName, isDevDesktopApp } from "./app-flavor";
import { DESKTOP_BUILD_FLAVOR } from "../shared/build-constants";
import * as buildConstants from "../shared/build-constants";
import { resolveLoginShellPath } from "./shell-env";
import { hideDashboard } from "./app-control";
import { resolveCliDaemonPath } from "./cli-path";
import {
  captureDesktopError,
  flushDesktopErrorReporting,
  initializeDesktopErrorReporting
} from "./error-reporting";

async function loadOptionalTelemetry(): Promise<{
  initializeTelemetry?: typeof import("@mcpx/core").initializeTelemetry;
  captureTelemetryEvent?: typeof import("@mcpx/core").captureTelemetryEvent;
  architecture?: typeof import("@mcpx/core").architecture;
  platformFamily?: typeof import("@mcpx/core").platformFamily;
  getTelemetryStatus?: typeof import("@mcpx/core").getTelemetryStatus;
}> {
  try {
    return await import("@mcpx/core");
  } catch {
    // Some test and embedded hosts provide only the core methods they need.
    return {};
  }
}

function readOptional<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

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
  return resolveCliDaemonPath(process.resourcesPath, app.getAppPath());
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

  // Initialize diagnostics BEFORE any Electron API calls. Sentry owns the
  // Crashpad integration when configured; the fallback keeps local-only crash
  // collection for builds without a DSN.
  if (DESKTOP_BUILD_FLAVOR === "dev") {
    process.env.MCPX_DESKTOP_FLAVOR = "dev";
  }
  const telemetryBuildConfig = readOptional(() => buildConstants.TELEMETRY_BUILD_CONFIG) ?? {
    posthogToken: "",
    posthogHost: "",
    sentryDsn: "",
    sentryRelease: ""
  };
  const telemetry = process.env.VITEST === "true" ? {} : await loadOptionalTelemetry();
  if (telemetryBuildConfig.posthogToken && !process.env.MCPX_POSTHOG_PROJECT_TOKEN) {
    process.env.MCPX_POSTHOG_PROJECT_TOKEN = telemetryBuildConfig.posthogToken;
  }
  if (telemetryBuildConfig.posthogHost && !process.env.MCPX_POSTHOG_HOST) {
    process.env.MCPX_POSTHOG_HOST = telemetryBuildConfig.posthogHost;
  }
  if (telemetryBuildConfig.sentryDsn && !process.env.MCPX_SENTRY_DSN) {
    process.env.MCPX_SENTRY_DSN = telemetryBuildConfig.sentryDsn;
  }
  const release = telemetryBuildConfig.sentryRelease || process.env.MCPX_SENTRY_RELEASE || "desktop";
  const version = release.startsWith("mcpx@") ? release.slice("mcpx@".length) : release;
  if (!process.env.MCPX_SENTRY_RELEASE && telemetryBuildConfig.sentryRelease) {
    process.env.MCPX_SENTRY_RELEASE = telemetryBuildConfig.sentryRelease;
  }
  await readOptional(() => telemetry.initializeTelemetry)?.("desktop", {
    release,
    platform: process.platform,
    architecture: process.arch
  });
  await initializeDesktopErrorReporting(release, productName);

  if (await runDaemonChildIfRequested()) {
    return;
  }

  if (process.platform === "darwin") {
    app.setActivationPolicy("regular");
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

  app.on("second-instance", () => {
    openDashboard();
  });

  await app.whenReady();

  if (readOptional(() => telemetry.getTelemetryStatus)?.()?.usageActive) {
    readOptional(() => telemetry.captureTelemetryEvent)?.({
      name: "runtime_started",
      properties: {
        runtime: "desktop",
        version,
        osFamily: readOptional(() => telemetry.platformFamily)?.() ?? "other",
        architecture: readOptional(() => telemetry.architecture)?.() ?? process.arch,
        launchMode: "desktop"
      }
    });
  }

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

  // Surface upstream call-time / re-auth errors as macOS notifications.
  startErrorNotifier();
  startMarketplaceAutoUpdater();

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
    // Startup failures are unexpected diagnostics; the existing dialog and
    // exit behavior remain unchanged if reporting is disabled or unavailable.
    captureDesktopError(error, "startup");
    await flushDesktopErrorReporting(150);
    handleStartupError(error);
    throw error;
  }
}

if (process.env.VITEST !== "true") {
  void startMainProcess().catch(() => {
    // startMainProcess already reports startup failures.
  });
}
