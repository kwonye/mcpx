import { Tray, nativeImage, Menu, app } from "electron";
import { join } from "node:path";
import { hidePopover, togglePopover } from "./popover";
import { getDesktopProductName, isDevDesktopApp } from "./app-flavor";

let tray: Tray | null = null;
let daemonRunning = false;
let onQuitRequested: (() => void) | null = null;
let onStartDaemonRequested: (() => void) | null = null;
let onStopDaemonRequested: (() => void) | null = null;

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

export function createTray(): Tray {
  const productName = getDesktopProductName();
  const iconName = isDevDesktopApp() ? "trayIconDevTemplate.png" : "trayIconTemplate.png";
  const icon = nativeImage.createFromPath(
    join(__dirname, "../../resources", iconName)
  );
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
  const tooltip = running ? `${productName} - Gateway running` : `${productName} - Gateway stopped`;
  tray.setToolTip(tooltip);
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
