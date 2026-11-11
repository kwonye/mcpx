import type { Rect } from "./types";

export type ScreenEdge = "top" | "bottom" | "left" | "right";

export const POPOVER_GAP = 8;

export function isValidRect(r: Rect | null | undefined): r is Rect {
  return Boolean(r) && r!.width > 0 && r!.height > 0;
}

/**
 * Which screen edge the menu bar / taskbar holding the tray sits on.
 * The edge where the work area is inset from the display bounds wins; when
 * nothing is inset (an auto-hiding taskbar) fall back to the display edge
 * nearest the tray icon.
 */
export function detectTaskbarEdge(display: Rect, workArea: Rect, tray: Rect): ScreenEdge {
  const insets: Record<ScreenEdge, number> = {
    top: workArea.y - display.y,
    bottom: display.y + display.height - (workArea.y + workArea.height),
    left: workArea.x - display.x,
    right: display.x + display.width - (workArea.x + workArea.width)
  };
  const inset = (Object.keys(insets) as ScreenEdge[])
    .filter((edge) => insets[edge] > 0)
    .sort((a, b) => insets[b] - insets[a])[0];
  if (inset) {
    return inset;
  }

  const cx = tray.x + tray.width / 2;
  const cy = tray.y + tray.height / 2;
  const distances: Record<ScreenEdge, number> = {
    top: cy - display.y,
    bottom: display.y + display.height - cy,
    left: cx - display.x,
    right: display.x + display.width - cx
  };
  return (Object.keys(distances) as ScreenEdge[]).sort((a, b) => distances[a] - distances[b])[0];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Position the popover next to the tray icon, on the inner side of whichever
 * edge the taskbar is on, and keep it fully inside the work area.
 */
export function computePopoverPosition(args: {
  tray: Rect;
  display: Rect;
  workArea: Rect;
  size: { width: number; height: number };
  gap?: number;
}): { x: number; y: number; edge: ScreenEdge } {
  const { tray, display, workArea, size } = args;
  const gap = args.gap ?? POPOVER_GAP;
  const edge = detectTaskbarEdge(display, workArea, tray);

  const centeredX = tray.x + tray.width / 2 - size.width / 2;
  const centeredY = tray.y + tray.height / 2 - size.height / 2;
  const waRight = workArea.x + workArea.width;
  const waBottom = workArea.y + workArea.height;

  let x: number;
  let y: number;
  switch (edge) {
    case "top":
      x = centeredX;
      y = Math.max(workArea.y, tray.y + tray.height) + gap;
      break;
    case "bottom":
      x = centeredX;
      y = Math.min(waBottom, tray.y) - size.height - gap;
      break;
    case "left":
      x = Math.max(workArea.x, tray.x + tray.width) + gap;
      y = centeredY;
      break;
    case "right":
      x = Math.min(waRight, tray.x) - size.width - gap;
      y = centeredY;
      break;
  }

  return {
    x: Math.round(clamp(x, workArea.x + gap, waRight - size.width - gap)),
    y: Math.round(clamp(y, workArea.y + gap, waBottom - size.height - gap)),
    edge
  };
}
