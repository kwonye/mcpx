import { app, dialog } from "electron";
import { autoUpdater } from "electron-updater";
import { captureTelemetryEvent } from "@mcpx/core";
import type { TelemetryEvent } from "@mcpx/core";
import { getDesktopProductName, isDevDesktopApp } from "./app-flavor";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type UpdateCheckStatus = "up-to-date" | "available" | "downloaded" | "error" | "unsupported";
export interface UpdateCheckResult {
  status: UpdateCheckStatus;
  message: string;
}

/** Maps an electron-updater outcome to what a manual "Check for updates" reports. */
export function updateCheckResult(
  outcome: "update-available" | "update-not-available" | "update-downloaded",
  version?: string
): UpdateCheckResult {
  const named = version ? `Update ${version}` : "An update";
  switch (outcome) {
    case "update-available":
      return {
        status: "available",
        message: `${named} found. Downloading now and it will install on the next restart.`
      };
    case "update-not-available":
      return { status: "up-to-date", message: "You're already on the latest version." };
    case "update-downloaded":
      return { status: "downloaded", message: `${named} is ready. Restart to install it.` };
  }
}

let checkInterval: ReturnType<typeof setInterval> | null = null;
let initialized = false;
let pendingResolve: ((result: UpdateCheckResult) => void) | null = null;
let pendingTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingUpdateVersion: string | undefined;
let downloaded: { version?: string } | null = null;
let pendingCheck: Promise<UpdateCheckResult> | null = null;
let beforeQuitAndInstall: (() => void) | null = null;

/**
 * Registers the app's coordinated quit preparation (mark the app as quitting,
 * stop the gateway that runs from the bundle being replaced). It runs right
 * before electron-updater quits and installs.
 */
export function setBeforeQuitAndInstall(handler: (() => void) | null): void {
  beforeQuitAndInstall = handler;
}

export function quitAndInstallUpdate(): void {
  try {
    beforeQuitAndInstall?.();
  } catch (error) {
    console.error("[update-manager] quit preparation failed:", error);
  }
  autoUpdater.quitAndInstall();
}

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

function settlePending(result: UpdateCheckResult): void {
  if (pendingTimeout) clearTimeout(pendingTimeout);
  pendingTimeout = null;
  const resolve = pendingResolve;
  pendingResolve = null;
  pendingCheck = null;
  resolve?.(result);
}

function runUpdaterCheck(): void {
  let check: Promise<unknown> | undefined;
  try {
    check = autoUpdater.checkForUpdates();
  } catch (error) {
    if (pendingResolve) {
      settlePending({ status: "error", message: `Update check failed: ${error instanceof Error ? error.message : String(error)}` });
    } else {
      captureUpdate("check", "failure", "update_check_failed");
    }
    return;
  }
  void Promise.resolve(check).catch((error: unknown) => {
    // electron-updater emits `error` and also rejects its check promise.
    // The event normally settles manual callers; this catch prevents an
    // unhandled rejection if the event is delayed or a background check fails.
    if (pendingResolve) {
      settlePending({ status: "error", message: `Update check failed: ${error instanceof Error ? error.message : String(error)}` });
    } else {
      captureUpdate("check", "failure", "update_check_failed");
    }
  });
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
    captureUpdate("check", "success", undefined, info.version);
    settlePending(updateCheckResult("update-available", info.version));
  });

  autoUpdater.on("update-not-available", () => {
    pendingUpdateVersion = undefined;
    captureUpdate("check", "success");
    settlePending(updateCheckResult("update-not-available"));
  });

  autoUpdater.on("error", (error) => {
    pendingUpdateVersion = undefined;
    captureUpdate("check", "failure", "update_check_failed");
    settlePending({ status: "error", message: `Update check failed: ${error.message}` });
  });

  autoUpdater.on("update-downloaded", (info?: { version?: string }) => {
    const targetVersion = info?.version ?? pendingUpdateVersion;
    pendingUpdateVersion = undefined;
    downloaded = { version: targetVersion };
    captureUpdate("install", "success", undefined, targetVersion);
    settlePending(updateCheckResult("update-downloaded", targetVersion));
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
        quitAndInstallUpdate();
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
  runUpdaterCheck();
  if (!checkInterval) {
    checkInterval = setInterval(() => {
      runUpdaterCheck();
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

export function checkForUpdatesNow(): Promise<UpdateCheckResult> {
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

  if (downloaded) {
    return Promise.resolve(updateCheckResult("update-downloaded", downloaded.version));
  }

  if (pendingCheck) {
    return pendingCheck;
  }

  pendingCheck = new Promise((resolve) => {
    pendingResolve = resolve;
    pendingTimeout = setTimeout(() => {
      captureUpdate("check", "failure", "update_check_timeout");
      settlePending({ status: "error", message: "Update check timed out." });
    }, 30_000);
    pendingTimeout.unref?.();
    runUpdaterCheck();
  });
  return pendingCheck;
}

export function disposeUpdateManager(): void {
  clearCheckInterval();
  if (pendingResolve) {
    settlePending({ status: "error", message: "Update manager disposed." });
  } else {
    pendingCheck = null;
    if (pendingTimeout) clearTimeout(pendingTimeout);
    pendingTimeout = null;
  }
  pendingUpdateVersion = undefined;
  downloaded = null;
  beforeQuitAndInstall = null;
  initialized = false;
}
