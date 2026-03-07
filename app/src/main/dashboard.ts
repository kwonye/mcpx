import { BrowserWindow, app } from "electron";
import { join } from "node:path";

let dashboard: BrowserWindow | null = null;

export function openDashboard(): BrowserWindow {
  if (dashboard && !dashboard.isDestroyed()) {
    dashboard.show();
    dashboard.setAlwaysOnTop(false);
    dashboard.focus();
    // Show dock icon when dashboard is opened
    app.dock?.show();
    return dashboard;
  }

  dashboard = new BrowserWindow({
    width: 900,
    height: 650,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    show: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    dashboard.loadURL(`${process.env.ELECTRON_RENDERER_URL}#dashboard`);
  } else {
    dashboard.loadFile(join(__dirname, "../renderer/index.html"), { hash: "dashboard" });
  }

  // Hide dock icon when window is closed
  dashboard.on("closed", () => {
    dashboard = null;
    app.dock?.hide();
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
