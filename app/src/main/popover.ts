import { BrowserWindow, screen, Tray } from "electron";
import { fileURLToPath } from "node:url";

function rendererEntryPath(): string {
  return fileURLToPath(new URL("../renderer/index.html", import.meta.url));
}

let popover: BrowserWindow | null = null;

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

function positionPopover(window: BrowserWindow, tray: Tray): void {
  const trayBounds = tray.getBounds();
  const windowBounds = window.getBounds();

  // macOS tray.getBounds() is unreliable and can return all zeros.
  // Fall back to cursor position (the user just clicked the tray).
  const hasValidBounds = trayBounds.width > 0 && trayBounds.height > 0;
  if (!hasValidBounds) {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const workArea = display.workArea;
    const x = Math.round(
      Math.min(
        Math.max(cursor.x - windowBounds.width / 2, workArea.x),
        workArea.x + workArea.width - windowBounds.width
      )
    );
    const y = Math.round(
      Math.min(
        Math.max(cursor.y + 8, workArea.y),
        workArea.y + workArea.height - windowBounds.height
      )
    );
    window.setPosition(x, y, false);
    return;
  }

  const display = screen.getDisplayMatching(trayBounds);
  const workArea = display.workArea;

  const x = Math.round(
    Math.min(
      Math.max(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2, workArea.x),
      workArea.x + workArea.width - windowBounds.width
    )
  );
  const y = Math.round(
    Math.min(
      Math.max(trayBounds.y + trayBounds.height + 8, workArea.y),
      workArea.y + workArea.height - windowBounds.height
    )
  );

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

export function showPopover(tray: Tray): BrowserWindow {
  const window = popover && !popover.isDestroyed() ? popover : createPopoverWindow();

  positionPopover(window, tray);
  window.show();
  window.focus();

  return window;
}

export function togglePopover(tray: Tray): BrowserWindow {
  const window = popover && !popover.isDestroyed() ? popover : createPopoverWindow();

  if (window.isVisible()) {
    window.hide();
    return window;
  }

  positionPopover(window, tray);
  window.show();
  window.focus();

  return window;
}

export function hidePopover(): void {
  if (popover && !popover.isDestroyed()) {
    popover.hide();
  }
}
