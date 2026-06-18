import { Menu } from "electron";
import { shell } from "electron";
import { getDesktopProductName } from "./app-flavor";
import { hideDashboard, quitApp } from "./app-control";

export function buildApplicationMenu(): Menu {
  const productName = getDesktopProductName();
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: productName,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { type: "separator" },
        {
          label: `Quit ${productName}`,
          accelerator: "CommandOrControl+Q",
          click: quitApp
        }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: "Window",
      submenu: [
        {
          label: "Close Window",
          accelerator: "CommandOrControl+W",
          click: hideDashboard
        },
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
        { type: "separator" },
        { role: "window" }
      ]
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Learn More",
          click: async () => {
            await shell.openExternal("https://github.com/kwonye/mcpx");
          }
        }
      ]
    }
  ];

  return Menu.buildFromTemplate(template);
}
