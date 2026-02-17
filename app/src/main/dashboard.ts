import { BrowserWindow } from "electron";
import { join } from "node:path";

let dashboard: BrowserWindow | null = null;

export function openDashboard(): BrowserWindow {
  if (dashboard && !dashboard.isDestroyed()) {
    dashboard.focus();
    return dashboard;
  }

  dashboard = new BrowserWindow({
    width: 900,
    height: 650,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
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

  dashboard.on("closed", () => {
    dashboard = null;
  });

  return dashboard;
}
