import { Menu, shell } from "electron";
import { getDesktopProductName } from "./app-flavor";
import { quitApp } from "./app-control";
import { navigateDashboard } from "./dashboard";
import { buildAppMenuTemplate, PROJECT_URL } from "./platform/menu-template";
import { toDesktopPlatform } from "./platform/types";

export function buildApplicationMenu(): Menu {
  return Menu.buildFromTemplate(
    buildAppMenuTemplate(toDesktopPlatform(), getDesktopProductName(), {
      openSettings: () => navigateDashboard("settings"),
      quit: quitApp,
      openProjectPage: () => {
        void shell.openExternal(PROJECT_URL);
      }
    })
  );
}
