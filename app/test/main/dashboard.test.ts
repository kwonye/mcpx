import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  dashboardWindowOptions,
  popoverWindowOptions,
  SANDBOX_RENDERERS,
  titleBarOverlayFor
} from "../../src/main/platform/window-options";

describe("dashboard window configuration", () => {
  describe("UI-04: title bar per platform", () => {
    it("macOS: hiddenInset with traffic lights inside the 78x44 gutter", () => {
      const options = dashboardWindowOptions("darwin", { dark: false, preloadPath: "/p.js" });

      expect(options.titleBarStyle).toBe("hiddenInset");
      expect(options.titleBarOverlay).toBeUndefined();
      const { x, y } = options.trafficLightPosition!;
      // Three ~14px buttons with ~6px gaps.
      expect(x + 3 * 14 + 2 * 6).toBeLessThanOrEqual(78);
      expect(y + 14).toBeLessThanOrEqual(44);
    });

    it("Windows: hidden title bar with a 40px caption overlay following the theme", () => {
      const light = dashboardWindowOptions("win32", { dark: false, preloadPath: "/p.js" });
      const dark = dashboardWindowOptions("win32", { dark: true, preloadPath: "/p.js" });

      expect(light.titleBarStyle).toBe("hidden");
      expect(light.titleBarOverlay).toEqual({ color: "#ffffff", symbolColor: "#1f1f1f", height: 40 });
      expect(dark.titleBarOverlay).toEqual({ color: "#1e1e1e", symbolColor: "#ffffff", height: 40 });
      expect(titleBarOverlayFor(true)).toEqual(dark.titleBarOverlay);
      expect(light.trafficLightPosition).toBeUndefined();
    });

    it("Linux: native frame with a window icon", () => {
      const options = dashboardWindowOptions("linux", { dark: false, preloadPath: "/p.js", linuxIconPath: "/icon.png" });

      expect(options.titleBarStyle).toBeUndefined();
      expect(options.titleBarOverlay).toBeUndefined();
      expect(options.frame).toBeUndefined();
      expect(options.icon).toBe("/icon.png");
    });

    for (const platform of ["darwin", "win32", "linux"] as const) {
      it(`${platform}: secure web preferences on dashboard and popover`, () => {
        for (const options of [
          dashboardWindowOptions(platform, { dark: false, preloadPath: "/p.js" }),
          popoverWindowOptions(platform, { preloadPath: "/p.js" })
        ]) {
          expect(options.webPreferences).toMatchObject({
            preload: "/p.js",
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
            sandbox: SANDBOX_RENDERERS,
            webviewTag: false
          });
        }
      });
    }

    it("only uses the macOS panel window type on macOS", () => {
      expect(popoverWindowOptions("darwin", { preloadPath: "/p.js" }).type).toBe("panel");
      expect(popoverWindowOptions("win32", { preloadPath: "/p.js" }).type).toBeUndefined();
      expect(popoverWindowOptions("linux", { preloadPath: "/p.js" }).type).toBeUndefined();
    });

    it("hides instead of closing while the tray exists", async () => {
      const source = await readFile(join(__dirname, "../../src/main/dashboard.ts"), "utf-8");

      expect(source).toContain('dashboard.on("close"');
      expect(source).toContain("dashboardCloseAction(");
      expect(source).toContain('window.webContents.send("navigate", route)');
    });

    it("does not show the dock icon when opening the dashboard", async () => {
      const source = await readFile(
        join(__dirname, "../../src/main/dashboard.ts"),
        "utf-8"
      );

      expect(source).not.toContain("app.dock?.show()");
      expect(source).not.toContain("setAlwaysOnTop");
    });

    it("reveals the dashboard without relying on the dock", async () => {
      const source = await readFile(
        join(__dirname, "../../src/main/app-control.ts"),
        "utf-8"
      );

      expect(source).toContain('app.focus({ steal: true })');
      const dashboardSource = await readFile(
        join(__dirname, "../../src/main/dashboard.ts"),
        "utf-8"
      );
      expect(dashboardWindowOptions("darwin", { dark: false, preloadPath: "/p.js" }).show).toBe(false);
      expect(dashboardSource).toContain('dashboard.once("ready-to-show"');
      expect(dashboardSource).toContain('dashboard.loadFile(rendererEntryPath(), { hash: "dashboard" })');
    });
  });
});
