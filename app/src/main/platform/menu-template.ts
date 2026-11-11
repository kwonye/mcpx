import type { MenuItemConstructorOptions } from "electron";
import type { DesktopPlatform } from "./types";

export const PROJECT_URL = "https://github.com/kwonye/mcpx";

export interface AppMenuActions {
  openSettings: () => void;
  quit: () => void;
  openProjectPage: () => void;
}

/** Application menu: the standard macOS app menu, or a File/Edit/View/Window/Help bar elsewhere. */
export function buildAppMenuTemplate(
  platform: DesktopPlatform,
  productName: string,
  actions: AppMenuActions
): MenuItemConstructorOptions[] {
  const settingsItem: MenuItemConstructorOptions = {
    label: "Settings…",
    accelerator: "CmdOrCtrl+,",
    click: () => actions.openSettings()
  };
  const quitItem: MenuItemConstructorOptions = {
    label: `Quit ${productName}`,
    accelerator: "CmdOrCtrl+Q",
    click: () => actions.quit()
  };
  const learnMore: MenuItemConstructorOptions = {
    label: "Learn More",
    click: () => actions.openProjectPage()
  };
  const editMenu: MenuItemConstructorOptions = {
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
  };
  const viewMenu: MenuItemConstructorOptions = {
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
  };

  if (platform === "darwin") {
    return [
      {
        label: productName,
        submenu: [
          { role: "about" },
          { type: "separator" },
          settingsItem,
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          quitItem
        ]
      },
      {
        label: "File",
        submenu: [{ role: "close" }]
      },
      editMenu,
      viewMenu,
      {
        label: "Window",
        submenu: [
          { role: "minimize" },
          { role: "zoom" },
          { type: "separator" },
          { role: "front" },
          { type: "separator" },
          { role: "window" }
        ]
      },
      { role: "help", submenu: [learnMore] }
    ];
  }

  return [
    {
      label: "&File",
      submenu: [
        settingsItem,
        { type: "separator" },
        { role: "close", label: "Close Window" },
        quitItem
      ]
    },
    { ...editMenu, label: "&Edit" },
    { ...viewMenu, label: "&View" },
    {
      label: "&Window",
      submenu: [{ role: "minimize" }, { role: "close" }]
    },
    {
      label: "&Help",
      submenu: [learnMore, { type: "separator" }, { role: "about", label: `About ${productName}` }]
    }
  ];
}
