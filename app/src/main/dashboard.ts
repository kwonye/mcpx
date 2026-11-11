import { BrowserWindow, nativeTheme } from "electron";
import { hidePopover } from "./popover";
import {
  getDashboardWindow,
  hideDashboard as hideDashboardWindow,
  isQuitting,
  isTrayAvailable,
  revealDashboard,
  setDashboardWindow
} from "./app-control";
import { preloadPath, rendererEntryPath } from "./app-paths";
import { dashboardCloseAction } from "./platform/lifecycle";
import { resourcePath } from "./platform/resources";
import { toDesktopPlatform, type DashboardRoute } from "./platform/types";
import { dashboardWindowOptions, titleBarOverlayFor, windowBackgroundColor } from "./platform/window-options";

export function openDashboard(): BrowserWindow {
  hidePopover();

  const existing = getDashboardWindow();
  if (existing) {
    revealDashboard();
    return existing;
  }

  const platform = toDesktopPlatform();
  const dashboard = new BrowserWindow(
    dashboardWindowOptions(platform, {
      dark: nativeTheme.shouldUseDarkColors,
      preloadPath: preloadPath(),
      linuxIconPath: resourcePath("linux", "icon-256.png")
    })
  );

  const onThemeUpdated = () => {
    if (dashboard.isDestroyed()) {
      return;
    }
    const dark = nativeTheme.shouldUseDarkColors;
    dashboard.setBackgroundColor(windowBackgroundColor(dark));
    if (platform === "win32") {
      dashboard.setTitleBarOverlay(titleBarOverlayFor(dark));
    }
  };
  nativeTheme.on("updated", onThemeUpdated);

  dashboard.webContents.on("did-fail-load", (_event, code, description, validatedUrl) => {
    console.error("[renderer] failed to load dashboard:", {
      code,
      description,
      validatedUrl
    });
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void dashboard.loadURL(`${process.env.ELECTRON_RENDERER_URL}#/dashboard`);
  } else {
    void dashboard.loadFile(rendererEntryPath(), { hash: "dashboard" });
  }

  dashboard.once("ready-to-show", () => {
    if (!dashboard.isDestroyed()) {
      revealDashboard();
    }
  });

  // Closing the window keeps mcpx running in the tray; only Quit closes it.
  dashboard.on("close", (event) => {
    if (dashboardCloseAction({ quitting: isQuitting(), trayAvailable: isTrayAvailable() }) === "hide") {
      event.preventDefault();
      hideDashboardWindow();
    }
  });

  dashboard.on("closed", () => {
    nativeTheme.removeListener("updated", onThemeUpdated);
    setDashboardWindow(null);
  });

  setDashboardWindow(dashboard);
  return dashboard;
}

/** Opens (or focuses) the dashboard and asks the renderer to show `route`. */
export function navigateDashboard(route: DashboardRoute): void {
  const window = openDashboard();
  const send = () => {
    if (!window.isDestroyed()) {
      window.webContents.send("navigate", route);
    }
  };
  if (window.webContents.isLoading()) {
    window.webContents.once("did-finish-load", send);
  } else {
    send();
  }
}

export function hideDashboard(): void {
  hideDashboardWindow();
}
