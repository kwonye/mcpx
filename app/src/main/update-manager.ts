import { app, dialog } from "electron";
import { autoUpdater } from "electron-updater";
import { getDesktopProductName, isDevDesktopApp } from "./app-flavor";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let checkInterval: ReturnType<typeof setInterval> | null = null;
let initialized = false;
let pendingResolve: ((result: { status: string; message: string }) => void) | null = null;

function ensureInitialized(): void {
  if (initialized) {
    return;
  }

  initialized = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    const message = `Update ${info.version} found. Downloading now and it will install on the next restart.`;
    if (pendingResolve) {
      pendingResolve({ status: "checking", message });
      pendingResolve = null;
    }
  });

  autoUpdater.on("update-not-available", () => {
    const message = "You're already on the latest version.";
    if (pendingResolve) {
      pendingResolve({ status: "downloaded", message });
      pendingResolve = null;
    }
  });

  autoUpdater.on("update-downloaded", () => {
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
    pendingResolve = resolve;
    autoUpdater.checkForUpdates();
  });
}

export function disposeUpdateManager(): void {
  clearCheckInterval();
  pendingResolve = null;
  initialized = false;
}
