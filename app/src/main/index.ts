import { app, dialog, Menu } from "electron";
import { loadConfig, startMarketplaceAutoUpdater } from "@mcpx/core";
import { createTray, setStartDaemonHandler, setStopDaemonHandler } from "./tray";
import { buildApplicationMenu } from "./menu";
import { openDashboard } from "./dashboard";
import { registerIpcHandlers } from "./ipc-handlers";
import { hidePopover, showPopover } from "./popover";
import { loadDesktopSettings } from "./settings-store";
import { applyStartOnLoginSetting, wasOpenedAtLogin } from "./login-item";
import { setAutoUpdateEnabled, setBeforeQuitAndInstall } from "./update-manager";
import { startErrorNotifier } from "./error-notifier";
import { getDesktopProductName, isDevDesktopApp } from "./app-flavor";
import { DESKTOP_BUILD_FLAVOR } from "../shared/build-constants";
import * as buildConstants from "../shared/build-constants";
import { resolveLoginShellPath } from "./shell-env";
import { hideDashboard, isTrayAvailable, markQuitting, setTrayAvailable } from "./app-control";
import {
  consumeGatewayResumeMarker,
  refreshGatewayStatus,
  startGateway,
  stopGateway,
  stopGatewayForUpdate
} from "./gateway-control";
import { installAppSecurity } from "./security";
import { appContentLocation } from "./app-paths";
import {
  isCliUpdateChildLaunch,
  shouldOpenDashboardAtLaunch,
  shouldRevealOnSecondInstance,
  windowAllClosedAction
} from "./platform/lifecycle";
import { probeLinuxTrayHost } from "./platform/linux-tray";
import { toDesktopPlatform } from "./platform/types";
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

/**
 * App lifecycle on every OS. With a tray, mcpx is background-resident: the
 * last window closing changes nothing and only an explicit Quit exits.
 * Without one (Linux with no StatusNotifier host) it is a normal windowed app.
 */
export function registerLifecycleHandlers(deps: {
  app: Pick<typeof import("electron").app, "on" | "quit">;
  openDashboard: () => void;
  isTrayAvailable: () => boolean;
  markQuitting: () => void;
}): void {
  deps.app.on("before-quit", () => {
    deps.markQuitting();
  });

  deps.app.on("window-all-closed", () => {
    if (windowAllClosedAction({ trayAvailable: deps.isTrayAvailable() }) === "quit") {
      deps.app.quit();
    }
  });

  deps.app.on("activate", () => {
    deps.openDashboard();
  });
}

/** Windows toast notifications and taskbar grouping need the installer's AppUserModelID. */
function windowsAppUserModelId(): string {
  if (!app.isPackaged) {
    return process.execPath;
  }
  return isDevDesktopApp() ? "io.github.kwonye.mcpx.dev" : "io.github.kwonye.mcpx";
}

async function createTrayIfSupported(): Promise<ReturnType<typeof createTray> | null> {
  if (toDesktopPlatform() === "linux" && !(await probeLinuxTrayHost())) {
    console.warn("[main] no StatusNotifier host found; running without a tray icon");
    return null;
  }
  try {
    return createTray();
  } catch (error) {
    console.error("[main] failed to create tray:", error);
    return null;
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
  // Core's background CLI updater (started by startDaemon) re-spawns
  // process.execPath with MCPX_UPDATE_CHILD=1. In the app that binary is the
  // GUI, so such a launch is not a real app start: leave immediately, before
  // the single-instance lock would pop the dashboard in the running app.
  if (isCliUpdateChildLaunch(process.env)) {
    app.exit(0);
    return;
  }

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

  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
    return;
  }

  app.on("second-instance", (_event, argv) => {
    if (shouldRevealOnSecondInstance(argv)) {
      void app.whenReady().then(() => openDashboard());
    }
  });

  if (toDesktopPlatform() === "win32") {
    app.setAppUserModelId(windowsAppUserModelId());
  }

  const loginShellPath = await resolveLoginShellPath();
  if (loginShellPath) {
    process.env.PATH = loginShellPath;
  }

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

  // Before any window exists: navigation/window-open guards, CSP, permissions.
  installAppSecurity(appContentLocation());

  Menu.setApplicationMenu(buildApplicationMenu());

  const settings = loadDesktopSettings();
  applyStartOnLoginSetting(settings.startOnLoginEnabled);
  setBeforeQuitAndInstall(() => {
    markQuitting();
    hidePopover();
    stopGatewayForUpdate();
  });
  setAutoUpdateEnabled(settings.autoUpdateEnabled);

  const tray = await createTrayIfSupported();
  setTrayAvailable(tray !== null);

  registerIpcHandlers();

  // Surface upstream call-time / re-auth errors as native notifications.
  startErrorNotifier();
  startMarketplaceAutoUpdater();

  setStartDaemonHandler(() => {
    void startGateway();
  });
  setStopDaemonHandler(() => {
    void stopGateway();
  });

  registerLifecycleHandlers({ app, openDashboard, isTrayAvailable, markQuitting });

  const hiddenLaunch = wasOpenedAtLogin();
  if (shouldOpenDashboardAtLaunch({ hiddenLaunch, trayAvailable: tray !== null })) {
    openDashboard();
  } else {
    // Hidden login launch: stay out of the Dock (macOS) and live in the tray.
    hideDashboard();
    if (tray && isDevDesktopApp()) {
      showPopover(tray);
    }
  }

  // Gateway: reflect the real state (the CLI may own it), then start it when
  // configured to, after an update stopped it, or on a login launch.
  try {
    const resumeAfterUpdate = consumeGatewayResumeMarker();
    if (!refreshGatewayStatus()) {
      const config = loadConfig();
      if (config.gateway.autoStart || resumeAfterUpdate || (hiddenLaunch && settings.startOnLoginEnabled)) {
        await startGateway();
      }
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
