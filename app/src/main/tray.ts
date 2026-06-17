import { Tray, nativeImage, Menu, app, NativeImage } from "electron";
import { join } from "node:path";
import { hidePopover, togglePopover } from "./popover";
import { getDesktopProductName, isDevDesktopApp } from "./app-flavor";

/**
 * Resolve path to a bundled resource file.
 * In production (asar bundle) __dirname points inside the asar archive where
 * nativeImage.createFromPath() cannot read files. process.resourcesPath always
 * points to the real filesystem directory (Contents/Resources on macOS), so
 * we use that when running from a packaged app.
 */
function resourcePath(...segments: string[]): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "app.asar.unpacked", "resources", ...segments);
  }
  // Dev mode: __dirname is out/main, resources is two levels up
  return join(__dirname, "../../resources", ...segments);
}

let tray: Tray | null = null;
let daemonRunning = false;
let onQuitRequested: (() => void) | null = null;
let onStartDaemonRequested: (() => void) | null = null;
let onStopDaemonRequested: (() => void) | null = null;

interface StatusIcons {
  green: NativeImage;
  red: NativeImage;
}

let cachedIcons: {
  normal: StatusIcons | null;
  dev: StatusIcons | null;
} = {
  normal: null,
  dev: null
};

export function setQuitHandler(handler: () => void): void {
  onQuitRequested = handler;
}

export function setStartDaemonHandler(handler: () => void): void {
  onStartDaemonRequested = handler;
}

export function setStopDaemonHandler(handler: () => void): void {
  onStopDaemonRequested = handler;
}

function buildContextMenu(daemonRunning: boolean): Menu {
  const template: Electron.MenuItemConstructorOptions[] = [];

  if (daemonRunning) {
    template.push(
      {
        label: "Stop Gateway",
        click: () => {
          onStopDaemonRequested?.();
        }
      },
      { type: "separator" }
    );
  } else {
    template.push(
      {
        label: "Start Gateway",
        click: () => {
          onStartDaemonRequested?.();
        }
      },
      { type: "separator" }
    );
  }

  template.push({
    label: "Quit",
    click: () => {
      onQuitRequested?.();
    }
  });

  return Menu.buildFromTemplate(template);
}

function loadStatusIcons(): { normal: StatusIcons; dev: StatusIcons } {
  if (process.platform !== "darwin") {
    // Linux and Windows: use PNG icons (no template image support)
    const icon = nativeImage.createFromPath(
      resourcePath("linux", "tray-icon.png")
    );
    return {
      normal: { green: icon, red: icon },
      dev: { green: icon, red: icon }
    };
  }

  return {
    normal: {
      green: nativeImage.createFromPath(resourcePath("trayIconTemplate-green.png")),
      red: nativeImage.createFromPath(resourcePath("trayIconTemplate-red.png"))
    },
    dev: {
      green: nativeImage.createFromPath(resourcePath("trayIconDevTemplate-green.png")),
      red: nativeImage.createFromPath(resourcePath("trayIconDevTemplate-red.png"))
    }
  };
}

function getStatusIcon(running: boolean): NativeImage {
  const isDev = isDevDesktopApp();
  const icons = cachedIcons[isDev ? 'dev' : 'normal'];
  
  if (running) {
    return icons?.green || nativeImage.createFromPath(resourcePath(isDev ? "trayIconDevTemplate-green.png" : "trayIconTemplate-green.png"));
  } else {
    return icons?.red || nativeImage.createFromPath(resourcePath(isDev ? "trayIconDevTemplate-red.png" : "trayIconTemplate-red.png"));
  }
}

export function createTray(): Tray {
  const productName = getDesktopProductName();
  
  if (!cachedIcons.normal) {
    const icons = loadStatusIcons();
    cachedIcons.normal = icons.normal;
    cachedIcons.dev = icons.dev;
  }
  
  const icon = getStatusIcon(daemonRunning);
  tray = new Tray(icon);
  tray.setToolTip(productName);

  tray.on("click", () => {
    togglePopover(tray);
  });

  tray.on("right-click", () => {
    hidePopover();
    tray!.popUpContextMenu(buildContextMenu(daemonRunning));
  });

  return tray;
}

export function updateTrayForDaemonStatus(running: boolean): void {
  if (!tray) return;

  daemonRunning = running;
  const productName = getDesktopProductName();
  const icon = getStatusIcon(running);
  tray.setImage(icon);
  tray.setToolTip(`${productName} - ${running ? 'Gateway running' : 'Gateway stopped'}`);
}

export function hideTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

export function showTray(): void {
  if (!tray) {
    createTray();
  }
}
