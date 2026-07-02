import { BrowserWindow, nativeTheme } from "electron";
import { fileURLToPath } from "node:url";
import { hidePopover } from "./popover";
import { getDashboardWindow, revealDashboard, setDashboardWindow, hideDashboard as hideDashboardWindow } from "./app-control";

function rendererEntryPath(): string {
  return fileURLToPath(new URL("../renderer/index.html", import.meta.url));
}

export function openDashboard(): BrowserWindow {
  hidePopover();

  const existing = getDashboardWindow();
  if (existing) {
    revealDashboard();
    return existing;
  }

  const bgColor = nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#ffffff";
  const dashboard = new BrowserWindow({
    width: 1100,
    height: 700,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 16 },
    show: false,
    backgroundColor: bgColor,
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/index.js", import.meta.url)),
      sandbox: false
    }
  });

  // Update backgroundColor on theme change
  nativeTheme.on("updated", () => {
    if (!dashboard.isDestroyed()) {
      dashboard.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#ffffff");
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
    if (!dashboard.isDestroyed()) {
      revealDashboard();
    }
  });

  dashboard.on("closed", () => {
    setDashboardWindow(null);
  });

  setDashboardWindow(dashboard);
  return dashboard;
}

export function hideDashboard(): void {
  hideDashboardWindow();
}
