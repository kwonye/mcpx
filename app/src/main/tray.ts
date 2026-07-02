import { Tray, nativeImage, Menu, app, NativeImage } from "electron";
import { join } from "node:path";
import { hidePopover, togglePopover } from "./popover";
import { getDesktopProductName, isDevDesktopApp } from "./app-flavor";
import { quitApp } from "./app-control";

let tray: Tray | null = null;
let daemonRunning = false;
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
    click: quitApp
  });

  return Menu.buildFromTemplate(template);
}

function loadStatusIcons(): { normal: StatusIcons; dev: StatusIcons } {
  if (process.platform !== "darwin") {
    // Linux and Windows: use PNG icons (no template image support)
    const icon = nativeImage.createFromPath(
      join(__dirname, "../../resources/linux/tray-icon.png")
    );
    return {
      normal: { green: icon, red: icon },
      dev: { green: icon, red: icon }
    };
  }

  const normalGreen = nativeImage.createFromPath(join(__dirname, "../../resources/trayIconTemplate-green.png"));
  const normalRed = nativeImage.createFromPath(join(__dirname, "../../resources/trayIconTemplate-red.png"));
  const devGreen = nativeImage.createFromPath(join(__dirname, "../../resources/trayIconDevTemplate-green.png"));
  const devRed = nativeImage.createFromPath(join(__dirname, "../../resources/trayIconDevTemplate-red.png"));

  if (process.platform === "darwin") {
    normalGreen.setTemplateImage(true);
    normalRed.setTemplateImage(true);
    devGreen.setTemplateImage(true);
    devRed.setTemplateImage(true);
  }

  return {
    normal: { green: normalGreen, red: normalRed },
    dev: { green: devGreen, red: devRed }
  };
}

function getStatusIcon(running: boolean): NativeImage {
  const isDev = isDevDesktopApp();
  const icons = cachedIcons[isDev ? 'dev' : 'normal'];
  
  if (running) {
    return icons?.green || nativeImage.createFromPath(join(__dirname, "../../resources", isDev ? "trayIconDevTemplate-green.png" : "trayIconTemplate-green.png"));
  } else {
    return icons?.red || nativeImage.createFromPath(join(__dirname, "../../resources", isDev ? "trayIconDevTemplate-red.png" : "trayIconTemplate-red.png"));
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
