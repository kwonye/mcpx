import { app, type BrowserWindow } from "electron";
import { hidePopover } from "./popover";

let dashboard: BrowserWindow | null = null;
let quitting = false;
let trayAvailable = true;

export function setDashboardWindow(window: BrowserWindow | null): void {
  dashboard = window;
}

export function getDashboardWindow(): BrowserWindow | null {
  return dashboard && !dashboard.isDestroyed() ? dashboard : null;
}

/** Whether mcpx has a tray icon to live in. False only on Linux without a StatusNotifier host. */
export function setTrayAvailable(available: boolean): void {
  trayAvailable = available;
}

export function isTrayAvailable(): boolean {
  return trayAvailable;
}

export function isQuitting(): boolean {
  return quitting;
}

/** Marks the app as quitting so window close handlers stop hiding instead of closing. */
export function markQuitting(): void {
  quitting = true;
}

/**
 * macOS: show the Dock icon and app menu only while the dashboard is visible.
 * While mcpx sits in the menu bar it is an accessory app.
 */
function setDockVisible(visible: boolean): void {
  if (process.platform === "darwin") {
    app.setActivationPolicy(visible ? "regular" : "accessory");
  }
}

export function revealDashboard(): void {
  const window = getDashboardWindow();
  if (!window) {
    return;
  }

  setDockVisible(true);
  if (window.isMinimized()) {
    window.restore();
  }
  if (!window.isVisible()) {
    window.show();
  }
  app.focus({ steal: true });
  window.focus();
}

export function hideDashboard(): void {
  const window = getDashboardWindow();
  if (window) {
    window.hide();
  }
  if (trayAvailable) {
    setDockVisible(false);
  }
}

/**
 * The single quit path (tray, app menu, Cmd/Ctrl+Q, renderer, updater).
 * The gateway daemon is a background service and keeps running; stop it
 * explicitly with "Stop Gateway".
 */
export function quitApp(): void {
  markQuitting();
  hidePopover();
  app.quit();
}
