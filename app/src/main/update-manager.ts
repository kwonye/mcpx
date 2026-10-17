import { app, dialog } from "electron";
import { autoUpdater } from "electron-updater";
import { captureTelemetryEvent } from "@mcpx/core";
import type { TelemetryEvent } from "@mcpx/core";
import { getDesktopProductName, isDevDesktopApp } from "./app-flavor";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let checkInterval: ReturnType<typeof setInterval> | null = null;
let initialized = false;
let pendingResolve: ((result: { status: string; message: string }) => void) | null = null;
let pendingTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingUpdateVersion: string | undefined;

function currentVersion(): string | undefined {
  try {
    const version = app.getVersion();
    return /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,31}$/.test(version) ? version : undefined;
  } catch {
    return undefined;
  }
}

function captureUpdate(action: "check" | "install" | "rollback", outcome: "success" | "failure", errorCode?: string, toVersion?: string): void {
  const events: TelemetryEvent[] = [
    {
      name: "update_completed",
      properties: {
        action,
        outcome,
        ...(currentVersion() ? { fromVersion: currentVersion() } : {}),
        ...(toVersion ? { toVersion } : {})
      }
    },
    {
      name: "operation_completed",
      properties: {
        operation: action === "check" ? "update_check" : action === "install" ? "update_install" : "update_rollback",
        outcome,
        ...(errorCode ? { errorCode } : {})
      }
    }
  ];
  for (const event of events) {
    try {
      captureTelemetryEvent(event);
    } catch {
      // Optional diagnostics must never affect update behavior.
    }
  }
}

function settlePending(result: { status: string; message: string }): void {
  if (pendingTimeout) clearTimeout(pendingTimeout);
  pendingTimeout = null;
  const resolve = pendingResolve;
  pendingResolve = null;
  resolve?.(result);
}

function ensureInitialized(): void {
  if (initialized) {
    return;
  }

  initialized = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    pendingUpdateVersion = info.version;
    const message = `Update ${info.version} found. Downloading now and it will install on the next restart.`;
    captureUpdate("check", "success", undefined, info.version);
    settlePending({ status: "checking", message });
  });

  autoUpdater.on("update-not-available", () => {
    pendingUpdateVersion = undefined;
    const message = "You're already on the latest version.";
    captureUpdate("check", "success");
    settlePending({ status: "downloaded", message });
  });

  autoUpdater.on("error", (error) => {
    pendingUpdateVersion = undefined;
    captureUpdate("check", "failure", "update_check_failed");
    settlePending({ status: "error", message: `Update check failed: ${error.message}` });
  });

  autoUpdater.on("update-downloaded", (info?: { version?: string }) => {
    const targetVersion = info?.version ?? pendingUpdateVersion;
    pendingUpdateVersion = undefined;
    captureUpdate("install", "success", undefined, targetVersion);
    void dialog.showMessageBox({
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update ready",
      message: `A new version of ${getDesktopProductName()} has been downloaded.`,
      detail: "Restart now to install the update."
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    }).catch((error) => {
      console.error("[update-manager] failed to show update dialog:", error);
    });
  });
}

function clearCheckInterval(): void {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

function startChecking(): void {
  autoUpdater.checkForUpdates();
  if (!checkInterval) {
    checkInterval = setInterval(() => {
      autoUpdater.checkForUpdates();
    }, CHECK_INTERVAL_MS);
  }
}

export function setAutoUpdateEnabled(enabled: boolean): void {
  if (!app.isPackaged || isDevDesktopApp()) {
    clearCheckInterval();
    return;
  }

  if (!enabled) {
    clearCheckInterval();
    return;
  }

  ensureInitialized();
  startChecking();
}

export function checkForUpdatesNow(): Promise<{ status: string; message: string }> {
  if (!app.isPackaged) {
    return Promise.resolve({
      status: "unsupported",
      message: "Updates are only available in packaged builds."
    });
  }

  if (isDevDesktopApp()) {
    return Promise.resolve({
      status: "unsupported",
      message: `Updates are disabled for ${getDesktopProductName()} builds.`
    });
  }

  ensureInitialized();

  return new Promise((resolve) => {
    if (pendingResolve) {
      pendingResolve({ status: "error", message: "An update check is already in progress." });
    }
    pendingResolve = resolve;
    pendingTimeout = setTimeout(() => {
      captureUpdate("check", "failure", "update_check_timeout");
      settlePending({ status: "error", message: "Update check timed out." });
    }, 30_000);
    pendingTimeout.unref?.();
    autoUpdater.checkForUpdates();
  });
}

export function disposeUpdateManager(): void {
  clearCheckInterval();
  pendingResolve = null;
  if (pendingTimeout) clearTimeout(pendingTimeout);
  pendingTimeout = null;
  pendingUpdateVersion = undefined;
  initialized = false;
}
