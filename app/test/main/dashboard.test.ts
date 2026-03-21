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
      
      expect(source).toContain('titleBarStyle: "hiddenInset"');
    });

    it("positions traffic lights at macOS standard position", async () => {
      const source = await readFile(
        join(__dirname, "../../src/main/dashboard.ts"),
        "utf-8"
      );
      
      expect(source).toContain("trafficLightPosition");
    });

    it("does not toggle the dock icon when opening or closing the dashboard", async () => {
      const source = await readFile(
        join(__dirname, "../../src/main/dashboard.ts"),
        "utf-8"
      );

      expect(source).not.toContain("app.dock?.show()");
      expect(source).not.toContain("app.dock?.hide()");
    });

    it("reveals the dashboard without relying on the dock", async () => {
      const source = await readFile(
        join(__dirname, "../../src/main/dashboard.ts"),
        "utf-8"
      );

      expect(source).toContain('app.focus({ steal: true })');
      expect(source).toContain('show: false');
      expect(source).toContain('dashboard.once("ready-to-show"');
      expect(source).toContain('dashboard.loadFile(rendererEntryPath(), { hash: "dashboard" })');
    });
  });

  describe("UI-01: macOS HIG compliance", () => {
    it("uses system font stack including -apple-system", async () => {
      const css = await readFile(
        join(__dirname, "../../src/renderer/index.css"),
        "utf-8"
      );
      
      expect(css).toContain("-apple-system");
    });

    it("enables font antialiasing", async () => {
      const css = await readFile(
        join(__dirname, "../../src/renderer/index.css"),
        "utf-8"
      );
      
      expect(css).toContain("-webkit-font-smoothing: antialiased");
    });

    it("enables osx font smoothing", async () => {
      const css = await readFile(
        join(__dirname, "../../src/renderer/index.css"),
        "utf-8"
      );
      
      expect(css).toContain("-moz-osx-font-smoothing: grayscale");
    });
  });

  describe("UI-02: Visual polish", () => {
    it("defines consistent border radius variables", async () => {
      const css = await readFile(
        join(__dirname, "../../src/renderer/index.css"),
        "utf-8"
      );
      
      expect(css).toContain("--radius-sm:");
      expect(css).toContain("--radius-md:");
      expect(css).toContain("--radius-lg:");
    });

    it("defines transition variables for smooth interactions", async () => {
      const css = await readFile(
        join(__dirname, "../../src/renderer/index.css"),
        "utf-8"
      );
      
      expect(css).toContain("--transition-fast:");
      expect(css).toContain("--transition-normal:");
    });

    it("defines shadow variables for depth", async () => {
      const css = await readFile(
        join(__dirname, "../../src/renderer/index.css"),
        "utf-8"
      );
      
      expect(css).toContain("--shadow-sm:");
      expect(css).toContain("--shadow-md:");
    });

    it("applies consistent spacing in sidebar", async () => {
      const css = await readFile(
        join(__dirname, "../../src/renderer/index.css"),
        "utf-8"
      );
      
      expect(css).toContain(".sidebar");
      expect(css).toContain("padding:");
    });
  });

  describe("UI-03: Dark mode support", () => {
    it("defines dark mode color palette", async () => {
      const css = await readFile(
        join(__dirname, "../../src/renderer/index.css"),
        "utf-8"
      );
      
      expect(css).toContain("--bg-dark:");
      expect(css).toContain("--bg-card:");
      expect(css).toContain("--text-primary:");
      expect(css).toContain("--text-secondary:");
    });

    it("uses CSS variables for theming", async () => {
      const css = await readFile(
        join(__dirname, "../../src/renderer/index.css"),
        "utf-8"
      );
      
      expect(css).toContain("var(--");
    });

    it("defines accent colors for interactive elements", async () => {
      const css = await readFile(
        join(__dirname, "../../src/renderer/index.css"),
        "utf-8"
      );
      
      expect(css).toContain("--accent-primary:");
    });

    it("defines semantic colors (success, error)", async () => {
      const css = await readFile(
        join(__dirname, "../../src/renderer/index.css"),
        "utf-8"
      );
      
      expect(css).toContain("--success:");
      expect(css).toContain("--error:");
    });
  });
});
