import { Tray, nativeImage, Menu, type NativeImage } from "electron";
import { hidePopover, togglePopover } from "./popover";
import { getDesktopProductName, isDevDesktopApp } from "./app-flavor";
import { quitApp } from "./app-control";
import { navigateDashboard, openDashboard } from "./dashboard";
import { resourcePath } from "./platform/resources";
import { toDesktopPlatform } from "./platform/types";
import { buildTrayMenuTemplate, trayBehaviorFor, trayIconFile, trayTooltip } from "./platform/tray-model";

let tray: Tray | null = null;
let daemonRunning = false;
let onStartDaemonRequested: (() => void) | null = null;
let onStopDaemonRequested: (() => void) | null = null;
const iconCache = new Map<string, NativeImage>();

export function setStartDaemonHandler(handler: () => void): void {
  onStartDaemonRequested = handler;
}

export function setStopDaemonHandler(handler: () => void): void {
  onStopDaemonRequested = handler;
}

function buildContextMenu(running: boolean): Menu {
  return Menu.buildFromTemplate(
    buildTrayMenuTemplate(getDesktopProductName(), running, {
      openDashboard: () => {
        openDashboard();
      },
      startGateway: () => onStartDaemonRequested?.(),
      stopGateway: () => onStopDaemonRequested?.(),
      openSettings: () => navigateDashboard("settings"),
      quit: quitApp
    })
  );
}

function getStatusIcon(running: boolean): NativeImage {
  const platform = toDesktopPlatform();
  const file = trayIconFile(platform, running, isDevDesktopApp());
  const cached = iconCache.get(file);
  if (cached) {
    return cached;
  }
  const icon = nativeImage.createFromPath(resourcePath(...file.split("/")));
  if (trayBehaviorFor(platform).templateImage) {
    icon.setTemplateImage(true);
  }
  iconCache.set(file, icon);
  return icon;
}

export function createTray(): Tray {
  const behavior = trayBehaviorFor(toDesktopPlatform());
  const newTray = new Tray(getStatusIcon(daemonRunning));
  tray = newTray;
  newTray.setToolTip(trayTooltip(getDesktopProductName(), daemonRunning));

  if (behavior.attachContextMenu) {
    newTray.setContextMenu(buildContextMenu(daemonRunning));
  }

  if (behavior.clickOpensPopover) {
    newTray.on("click", (_event, bounds) => {
      togglePopover(newTray, bounds);
    });
  }

  if (behavior.rightClickOpensMenu) {
    newTray.on("right-click", () => {
      hidePopover();
      newTray.popUpContextMenu(buildContextMenu(daemonRunning));
    });
  }

  return newTray;
}

export function updateTrayForDaemonStatus(running: boolean): void {
  daemonRunning = running;
  if (!tray) return;

  tray.setImage(getStatusIcon(running));
  tray.setToolTip(trayTooltip(getDesktopProductName(), running));
  if (trayBehaviorFor(toDesktopPlatform()).attachContextMenu) {
    // Linux hosts only read the menu that is attached, so rebuild it.
    tray.setContextMenu(buildContextMenu(running));
  }
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
