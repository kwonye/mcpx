import type { MenuItemConstructorOptions } from "electron";
import type { DesktopPlatform } from "./types";

export interface TrayBehavior {
  /** Left click toggles the quick-status popover. */
  clickOpensPopover: boolean;
  /** Right click pops up the context menu manually. */
  rightClickOpensMenu: boolean;
  /**
   * Attach the menu with `tray.setContextMenu`. Required on Linux, where
   * AppIndicator/StatusNotifier hosts never deliver click events and only
   * show a menu that was set up front.
   */
  attachContextMenu: boolean;
  /** Use macOS template images (tinted by the menu bar). */
  templateImage: boolean;
}

export function trayBehaviorFor(platform: DesktopPlatform): TrayBehavior {
  if (platform === "linux") {
    return { clickOpensPopover: false, rightClickOpensMenu: false, attachContextMenu: true, templateImage: false };
  }
  return {
    clickOpensPopover: true,
    rightClickOpensMenu: true,
    attachContextMenu: false,
    templateImage: platform === "darwin"
  };
}

/** Icon file under `resources/` for the tray, per platform and gateway state. */
export function trayIconFile(platform: DesktopPlatform, running: boolean, dev: boolean): string {
  if (platform === "darwin") {
    return `trayIcon${dev ? "Dev" : ""}Template-${running ? "green" : "red"}.png`;
  }
  if (platform === "win32") {
    return `win/trayIcon-${running ? "running" : "stopped"}.png`;
  }
  return "linux/tray-icon.png";
}

export function trayTooltip(productName: string, running: boolean): string {
  return `${productName} - ${running ? "Gateway running" : "Gateway stopped"}`;
}

export interface TrayMenuActions {
  openDashboard: () => void;
  startGateway: () => void;
  stopGateway: () => void;
  openSettings: () => void;
  quit: () => void;
}

/** The tray context menu, identical on every OS. */
export function buildTrayMenuTemplate(
  productName: string,
  running: boolean,
  actions: TrayMenuActions
): MenuItemConstructorOptions[] {
  return [
    { label: `Open ${productName}`, click: () => actions.openDashboard() },
    { type: "separator" },
    { label: running ? "Gateway: Running" : "Gateway: Stopped", enabled: false },
    running
      ? { label: "Stop Gateway", click: () => actions.stopGateway() }
      : { label: "Start Gateway", click: () => actions.startGateway() },
    { type: "separator" },
    { label: "Settings…", click: () => actions.openSettings() },
    { type: "separator" },
    { label: `Quit ${productName}`, click: () => actions.quit() }
  ];
}
