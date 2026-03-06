import { Tray, nativeImage, Menu } from "electron";
import { join } from "node:path";
import { openDashboard } from "./dashboard";

let tray: Tray | null = null;
let onQuitRequested: (() => void) | null = null;

export function setQuitHandler(handler: () => void): void {
  onQuitRequested = handler;
}

export function createTray(): Tray {
  const icon = nativeImage.createFromPath(
    join(__dirname, "../../resources/trayIconTemplate.png")
  );
  tray = new Tray(icon);
  tray.setToolTip("mcpx");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Quit",
      click: () => {
        onQuitRequested?.();
      }
    }
  ]);

  tray.on("click", () => {
    openDashboard();
  });

  tray.on("right-click", () => {
    tray!.popUpContextMenu(contextMenu);
  });

  return tray;
}
