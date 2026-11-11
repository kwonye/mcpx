import { BrowserWindow, Rectangle, screen, Tray } from "electron";
import { preloadPath, rendererEntryPath } from "./app-paths";
import { computePopoverPosition, isValidRect } from "./platform/popover-position";
import { toDesktopPlatform } from "./platform/types";
import { popoverWindowOptions } from "./platform/window-options";

let popover: BrowserWindow | null = null;
let lastValidTrayBounds: Rectangle | null = null;
/**
 * Clicking the tray icon while the popover is open blurs (and hides) it just
 * before the click arrives; without this the click would reopen it.
 */
let lastBlurHideAt = 0;
const BLUR_CLICK_WINDOW_MS = 300;

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

function positionPopover(window: BrowserWindow, tray: Tray, clickBounds?: Rectangle): void {
  // Anchor, in order of reliability: the click event's bounds, tray.getBounds()
  // (all-zeros on some macOS versions), the last good bounds, then the cursor.
  const candidates = [clickBounds, tray.getBounds(), lastValidTrayBounds];
  let anchor = candidates.find(isValidRect) ?? null;
  if (anchor) {
    lastValidTrayBounds = anchor;
  } else {
    const cursor = screen.getCursorScreenPoint();
    anchor = { x: cursor.x, y: cursor.y, width: 1, height: 1 };
  }

  const display = screen.getDisplayMatching(anchor);
  const { width, height } = window.getBounds();
  const { x, y } = computePopoverPosition({
    tray: anchor,
    display: display.bounds,
    workArea: display.workArea,
    size: { width, height }
  });
  window.setPosition(x, y, false);
}

function createPopoverWindow(): BrowserWindow {
  popover = new BrowserWindow(popoverWindowOptions(toDesktopPlatform(), { preloadPath: preloadPath() }));

  loadPopoverContent(popover);

  popover.on("blur", () => {
    // Skip hide while DevTools are focused
    if (popover?.webContents.isDevToolsOpened() && popover?.webContents.isDevToolsFocused()) {
      return;
    }
    if (popover?.isVisible()) {
      lastBlurHideAt = Date.now();
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
  if (Date.now() - lastBlurHideAt < BLUR_CLICK_WINDOW_MS) {
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
