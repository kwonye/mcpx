import { Tray, BrowserWindow, nativeImage } from "electron";
import { join } from "node:path";

let tray: Tray | null = null;
let popover: BrowserWindow | null = null;

function createPopoverWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 360,
    height: 400,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#popover`);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"), { hash: "popover" });
  }

  win.on("blur", () => win.hide());

  return win;
}

function positionPopoverNearTray(trayBounds: Electron.Rectangle, win: BrowserWindow): void {
  const { width, height } = win.getBounds();
  const x = Math.round(trayBounds.x + trayBounds.width / 2 - width / 2);
  const y = trayBounds.y + trayBounds.height;
  win.setBounds({ x, y, width, height });
}

export function createTray(): Tray {
  const icon = nativeImage.createFromPath(
    join(__dirname, "../../resources/trayIconTemplate.png")
  );
  tray = new Tray(icon);
  tray.setToolTip("mcpx");

  tray.on("click", () => {
    if (!popover) {
      popover = createPopoverWindow();
    }

    if (popover.isVisible()) {
      popover.hide();
    } else {
      const bounds = tray!.getBounds();
      positionPopoverNearTray(bounds, popover);
      popover.show();
      popover.focus();
    }
  });

  return tray;
}
