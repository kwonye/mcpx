import { BrowserWindow, Rectangle, screen, Tray } from "electron";
import { fileURLToPath } from "node:url";

function rendererEntryPath(): string {
  return fileURLToPath(new URL("../renderer/index.html", import.meta.url));
}

let popover: BrowserWindow | null = null;
let lastValidTrayBounds: Rectangle | null = null;

function loadPopoverContent(window: BrowserWindow): void {
  window.webContents.on("did-fail-load", (_event, code, description, validatedUrl) => {
    console.error("[renderer] failed to load popover:", {
      code,
      description,
      validatedUrl
    });
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(`${process.env.ELECTRON_RENDERER_URL}#popover`);
    return;
  }

  window.loadFile(rendererEntryPath(), { hash: "popover" });
}

function isValidRect(r: Rectangle): boolean {
  return r.width > 0 && r.height > 0;
}

function positionPopover(window: BrowserWindow, tray: Tray, clickBounds?: Rectangle): void {
  const windowBounds = window.getBounds();

  // Resolve anchor bounds in order of reliability:
  // 1. clickBounds from tray click event (most reliable on macOS)
  // 2. tray.getBounds() (sometimes all-zeros on macOS)
  // 3. cached last valid bounds
  const trayBounds = clickBounds && isValidRect(clickBounds)
    ? clickBounds
    : tray.getBounds();

  const anchorBounds = isValidRect(trayBounds)
    ? trayBounds
    : lastValidTrayBounds;

  if (anchorBounds && isValidRect(anchorBounds)) {
    lastValidTrayBounds = anchorBounds;
    const display = screen.getDisplayMatching(anchorBounds);
    const workArea = display.workArea;

    const x = Math.round(
      Math.min(
        Math.max(anchorBounds.x + anchorBounds.width / 2 - windowBounds.width / 2, workArea.x),
        workArea.x + workArea.width - windowBounds.width
      )
    );
    const y = Math.round(
      Math.min(
        Math.max(anchorBounds.y + anchorBounds.height + 8, workArea.y),
        workArea.y + workArea.height - windowBounds.height
      )
    );

    window.setPosition(x, y, false);
    return;
  }

  // No valid bounds at all — anchor to the top of the work area.
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const workArea = display.workArea;

  // If cursor is in the menubar band, the user just clicked the tray — center on cursor.
  // Otherwise pin to top-right (e.g. auto-show at startup when cursor is mid-screen).
  const cursorInMenubar = cursor.y <= workArea.y;
  let x: number;
  if (cursorInMenubar) {
    x = Math.round(
      Math.min(
        Math.max(cursor.x - windowBounds.width / 2, workArea.x),
        workArea.x + workArea.width - windowBounds.width
      )
    );
  } else {
    x = workArea.x + workArea.width - windowBounds.width - 12;
  }

  const y = workArea.y + 8;

  window.setPosition(x, y, false);
}

function createPopoverWindow(): BrowserWindow {
  popover = new BrowserWindow({
    width: 380,
    height: 520,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    fullscreenable: false,
    type: "panel",
    ...(process.platform === "darwin"
      ? { vibrancy: "menu" as const, visualEffectState: "active" as const }
      : {}),
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/index.js", import.meta.url)),
      sandbox: false
    }
  });

  loadPopoverContent(popover);

  popover.on("blur", (event) => {
    // Skip hide while DevTools are focused
    if (popover?.webContents.isDevToolsOpened() && popover?.webContents.isDevToolsFocused()) {
      return;
    }
    popover?.hide();
  });

  popover.on("closed", () => {
    popover = null;
  });

  return popover;
}

export function showPopover(tray: Tray, clickBounds?: Rectangle): BrowserWindow {
  const window = popover && !popover.isDestroyed() ? popover : createPopoverWindow();

  positionPopover(window, tray, clickBounds);
  window.show();
  window.focus();

  return window;
}

export function togglePopover(tray: Tray, clickBounds?: Rectangle): BrowserWindow {
  const window = popover && !popover.isDestroyed() ? popover : createPopoverWindow();

  if (window.isVisible()) {
    window.hide();
    return window;
  }

  positionPopover(window, tray, clickBounds);
  window.show();
  window.focus();

  return window;
}

export function hidePopover(): void {
  if (popover && !popover.isDestroyed()) {
    popover.hide();
  }
}
