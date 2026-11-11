import { describe, expect, it } from "vitest";
import { computePopoverPosition, detectTaskbarEdge } from "../../src/main/platform/popover-position";

const size = { width: 380, height: 520 };
const display = { x: 0, y: 0, width: 1920, height: 1080 };

function inside(pos: { x: number; y: number }, workArea: typeof display): boolean {
  return pos.x >= workArea.x
    && pos.y >= workArea.y
    && pos.x + size.width <= workArea.x + workArea.width
    && pos.y + size.height <= workArea.y + workArea.height;
}

describe("popover positioning", () => {
  it("top menu bar (macOS): below the icon, centred on it", () => {
    const workArea = { x: 0, y: 25, width: 1920, height: 1055 };
    const tray = { x: 1500, y: 0, width: 24, height: 24 };
    const pos = computePopoverPosition({ tray, display, workArea, size });

    expect(pos.edge).toBe("top");
    expect(pos.y).toBe(25 + 8);
    expect(pos.x).toBe(Math.round(1512 - 190));
    expect(inside(pos, workArea)).toBe(true);
  });

  it("bottom taskbar (Windows default): above the taskbar, clamped to the right edge", () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1032 };
    const tray = { x: 1840, y: 1040, width: 24, height: 32 };
    const pos = computePopoverPosition({ tray, display, workArea, size });

    expect(pos.edge).toBe("bottom");
    expect(pos.y + size.height).toBe(1032 - 8);
    expect(pos.x + size.width).toBe(1920 - 8);
    expect(inside(pos, workArea)).toBe(true);
  });

  it("left taskbar: to the right of the taskbar, near the icon", () => {
    const workArea = { x: 62, y: 0, width: 1858, height: 1080 };
    const tray = { x: 16, y: 980, width: 32, height: 32 };
    const pos = computePopoverPosition({ tray, display, workArea, size });

    expect(pos.edge).toBe("left");
    expect(pos.x).toBe(62 + 8);
    expect(pos.y + size.height).toBe(1080 - 8);
    expect(inside(pos, workArea)).toBe(true);
  });

  it("right taskbar: to the left of the taskbar", () => {
    const workArea = { x: 0, y: 0, width: 1858, height: 1080 };
    const tray = { x: 1874, y: 500, width: 32, height: 32 };
    const pos = computePopoverPosition({ tray, display, workArea, size });

    expect(pos.edge).toBe("right");
    expect(pos.x + size.width).toBe(1858 - 8);
    expect(pos.y).toBe(Math.round(516 - 260));
    expect(inside(pos, workArea)).toBe(true);
  });

  it("works on a secondary display with negative coordinates", () => {
    const second = { x: -1440, y: 0, width: 1440, height: 900 };
    const workArea = { x: -1440, y: 0, width: 1440, height: 852 };
    const tray = { x: -60, y: 860, width: 24, height: 32 };
    const pos = computePopoverPosition({ tray, display: second, workArea, size });

    expect(pos.edge).toBe("bottom");
    expect(inside(pos, workArea)).toBe(true);
  });

  it("auto-hidden taskbar: infers the edge from the icon position", () => {
    expect(detectTaskbarEdge(display, display, { x: 1800, y: 1060, width: 20, height: 20 })).toBe("bottom");
    expect(detectTaskbarEdge(display, display, { x: 1800, y: 2, width: 20, height: 20 })).toBe("top");
    expect(detectTaskbarEdge(display, display, { x: 2, y: 500, width: 20, height: 20 })).toBe("left");
  });
});
