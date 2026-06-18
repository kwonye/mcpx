import { app, type BrowserWindow } from "electron";
import { stopDaemon } from "@mcpx/core";
import { hidePopover } from "./popover";

let dashboard: BrowserWindow | null = null;

export function setDashboardWindow(window: BrowserWindow | null): void {
  dashboard = window;
}

export function getDashboardWindow(): BrowserWindow | null {
  return dashboard && !dashboard.isDestroyed() ? dashboard : null;
}

export function revealDashboard(): void {
  const window = getDashboardWindow();
  if (!window) {
    return;
  }

  if (!window.isVisible()) {
    window.show();
  }
  app.focus({ steal: true });
  window.focus();
}

export function hideDashboard(): void {
  const window = getDashboardWindow();
  if (!window) {
    return;
  }

  window.hide();
  if (process.platform === "darwin") {
    app.dock?.hide();
  }
}

export function quitApp(): void {
  hidePopover();
  stopDaemon();
  const window = getDashboardWindow();
  if (window) {
    window.destroy();
  }
  setDashboardWindow(null);
  app.quit();
}
