import { BrowserWindow, app } from "electron";
import { fileURLToPath } from "node:url";
import { hidePopover } from "./popover";

let dashboard: BrowserWindow | null = null;

function isDevMode(): boolean {
  return process.argv.includes("--dev");
}

function rendererEntryPath(): string {
  return fileURLToPath(new URL("../renderer/index.html", import.meta.url));
}

function revealDashboard(window: BrowserWindow): void {
  if (process.platform === "darwin") {
    app.dock?.show();
    app.focus({ steal: true });
  }

  if (!window.isVisible()) {
    window.show();
  }

  window.setAlwaysOnTop(true);
  window.setAlwaysOnTop(false);
  window.focus();
}

export function openDashboard(): BrowserWindow {
  hidePopover();

  if (dashboard && !dashboard.isDestroyed()) {
    revealDashboard(dashboard);
    return dashboard;
  }

  dashboard = new BrowserWindow({
    width: 1100,
    height: 700,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    show: false,
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/index.js", import.meta.url)),
      sandbox: false
    }
  });

  dashboard.webContents.on("did-fail-load", (_event, code, description, validatedUrl) => {
    console.error("[renderer] failed to load dashboard:", {
      code,
      description,
      validatedUrl
    });
  });

  dashboard.loadFile(rendererEntryPath(), { hash: "dashboard" });

  dashboard.once("ready-to-show", () => {
    if (dashboard && !dashboard.isDestroyed()) {
      revealDashboard(dashboard);
      if (isDevMode()) {
        dashboard.webContents.openDevTools({ mode: "right" });
      }
    }
  });

  dashboard.on("closed", () => {
    if (process.platform === "darwin") {
      app.dock?.hide();
    }
    dashboard = null;
  });

  return dashboard;
}

export function hideDashboard(): void {
  if (dashboard && !dashboard.isDestroyed()) {
    dashboard.hide();
  }
}

export function closeDashboard(): void {
  if (dashboard && !dashboard.isDestroyed()) {
    dashboard.close();
  }
}
