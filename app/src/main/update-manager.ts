import { app, dialog } from "electron";
import { autoUpdater } from "electron-updater";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let checkInterval: ReturnType<typeof setInterval> | null = null;
let initialized = false;
let updateDownloadedHandler: (() => void) | null = null;

async function checkForUpdatesSafe(): Promise<void> {
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    console.error("[update-manager] update check failed:", error);
  }
}

function clearCheckInterval(): void {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

function ensureInitialized(): void {
  if (initialized) {
    return;
  }

  initialized = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  updateDownloadedHandler = () => {
    void dialog.showMessageBox({
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update ready",
      message: "A new version of mcpx has been downloaded.",
      detail: "Restart now to install the update."
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    }).catch((error) => {
      console.error("[update-manager] failed to show update dialog:", error);
    });
  };

  autoUpdater.on("update-downloaded", updateDownloadedHandler);
}

function startChecking(): void {
  checkForUpdatesSafe();
  if (!checkInterval) {
    checkInterval = setInterval(() => {
      void checkForUpdatesSafe();
    }, CHECK_INTERVAL_MS);
  }
}

export function setAutoUpdateEnabled(enabled: boolean): void {
  if (!app.isPackaged) {
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

export function disposeUpdateManager(): void {
  clearCheckInterval();
  if (updateDownloadedHandler) {
    autoUpdater.removeListener("update-downloaded", updateDownloadedHandler);
    updateDownloadedHandler = null;
  }
  initialized = false;
}
