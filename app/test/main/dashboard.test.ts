import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("dashboard window configuration", () => {
  describe("UI-04: hiddenInset title bar", () => {
    it("uses hiddenInset titleBarStyle for native macOS controls", async () => {
      const source = await readFile(
        join(__dirname, "../../src/main/dashboard.ts"),
        "utf-8"
      );
      
      expect(source).toContain('titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default"');
    });

    it("positions traffic lights at macOS standard position", async () => {
      const source = await readFile(
        join(__dirname, "../../src/main/dashboard.ts"),
        "utf-8"
      );
      
      expect(source).toContain("trafficLightPosition");
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
      expect(dashboardSource).toContain('show: false');
      expect(dashboardSource).toContain('dashboard.once("ready-to-show"');
      expect(dashboardSource).toContain('dashboard.loadFile(rendererEntryPath(), { hash: "dashboard" })');
    });
  });
});
