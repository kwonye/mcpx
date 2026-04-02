import { app, dialog } from "electron";
import { autoUpdater } from "electron-updater";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let checkInterval: ReturnType<typeof setInterval> | null = null;
let initialized = false;
let updateDownloadedHandler: (() => void) | null = null;

export interface UpdateCheckResult {
  status: "unsupported" | "checking" | "downloaded";
  message: string;
}

async function runUpdateCheck(): Promise<UpdateCheckResult> {
  if (!app.isPackaged) {
    return {
      status: "unsupported",
      message: "Updates are only available in packaged builds."
    };
  }

  ensureInitialized();

  try {
    const result = await autoUpdater.checkForUpdates();
    const version = result?.updateInfo?.version;

    if (version) {
      return {
        status: "checking",
        message: `Update ${version} found. Downloading now and it will install on the next restart.`
      };
    }

    return {
      status: "downloaded",
      message: "You're already on the latest version."
    };
  } catch (error) {
    console.error("[update-manager] update check failed:", error);
    throw error;
  }
}

async function checkForUpdatesSafe(): Promise<void> {
  try {
    await runUpdateCheck();
  } catch {
    // Logged in runUpdateCheck.
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
  autoUpdater.autoInstallOnAppQuit = true;

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

export function checkForUpdatesNow(): Promise<UpdateCheckResult> {
  return runUpdateCheck();
}

export function disposeUpdateManager(): void {
  clearCheckInterval();
  if (updateDownloadedHandler) {
    autoUpdater.removeListener("update-downloaded", updateDownloadedHandler);
    updateDownloadedHandler = null;
  }
  initialized = false;
}
