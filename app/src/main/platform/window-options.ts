import type { BrowserWindowConstructorOptions, TitleBarOverlayOptions, WebPreferences } from "electron";
import type { DesktopPlatform } from "./types";

/**
 * Renderer sandboxing. The preload is a single bundled CommonJS file that only
 * requires "electron", so it runs inside the Chromium sandbox. If a future
 * preload change needs Node APIs, flip this one switch (and fix the preload
 * instead if at all possible).
 */
export const SANDBOX_RENDERERS = true;

/** Height of the Windows caption-button overlay; the renderer reserves the same. */
export const WINDOWS_TITLE_BAR_HEIGHT = 40;

/** Places the macOS traffic lights inside the renderer's 78x44 top-left gutter. */
export const MAC_TRAFFIC_LIGHT_POSITION = { x: 16, y: 15 } as const;

export function windowBackgroundColor(dark: boolean): string {
  return dark ? "#1e1e1e" : "#ffffff";
}

/** Windows caption-button overlay colours, following the system light/dark theme. */
export function titleBarOverlayFor(dark: boolean): TitleBarOverlayOptions {
  return {
    color: windowBackgroundColor(dark),
    symbolColor: dark ? "#ffffff" : "#1f1f1f",
    height: WINDOWS_TITLE_BAR_HEIGHT
  };
}

export function secureWebPreferences(preloadPath: string): WebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    sandbox: SANDBOX_RENDERERS,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    navigateOnDragDrop: false
  };
}

export function dashboardWindowOptions(
  platform: DesktopPlatform,
  opts: { dark: boolean; preloadPath: string; linuxIconPath?: string }
): BrowserWindowConstructorOptions {
  const base: BrowserWindowConstructorOptions = {
    width: 1100,
    height: 700,
    show: false,
    backgroundColor: windowBackgroundColor(opts.dark),
    webPreferences: secureWebPreferences(opts.preloadPath)
  };

  if (platform === "darwin") {
    return {
      ...base,
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { ...MAC_TRAFFIC_LIGHT_POSITION }
    };
  }

  if (platform === "win32") {
    return {
      ...base,
      titleBarStyle: "hidden",
      titleBarOverlay: titleBarOverlayFor(opts.dark)
    };
  }

  // Linux: the standard native frame from the window manager.
  return {
    ...base,
    ...(opts.linuxIconPath ? { icon: opts.linuxIconPath } : {})
  };
}

export function popoverWindowOptions(
  platform: DesktopPlatform,
  opts: { preloadPath: string }
): BrowserWindowConstructorOptions {
  return {
    width: 380,
    height: 520,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    fullscreenable: false,
    // "panel" only means something on macOS (a non-activating NSPanel).
    ...(platform === "darwin"
      ? { type: "panel", vibrancy: "menu" as const, visualEffectState: "active" as const }
      : {}),
    webPreferences: secureWebPreferences(opts.preloadPath)
  };
}
