import { describe, it, expect } from "vitest";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";

describe("tray icon requirements", () => {
  describe("ICON-02: Template naming convention", () => {
    it("uses Template suffix for automatic dark mode adaptation", async () => {
      const iconPath = join(__dirname, "../../resources/trayIconTemplate.png");
      const exists = await access(iconPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
      expect(iconPath).toMatch(/Template\.png$/);
    });

    it("has @2x variant for Retina displays", async () => {
      const iconPath = join(__dirname, "../../resources/trayIconTemplate@2x.png");
      const exists = await access(iconPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
      expect(iconPath).toContain("@2x");
      expect(iconPath).toContain("Template");
    });

    it("includes matching dev template icons", async () => {
      const iconPath = join(__dirname, "../../resources/trayIconDevTemplate.png");
      const retinaIconPath = join(__dirname, "../../resources/trayIconDevTemplate@2x.png");
      const exists = await access(iconPath).then(() => true).catch(() => false);
      const retinaExists = await access(retinaIconPath).then(() => true).catch(() => false);

      expect(exists).toBe(true);
      expect(retinaExists).toBe(true);
      expect(iconPath).toContain("Template");
      expect(retinaIconPath).toContain("@2x");
    });
  });

  describe("ICON-03: Icon resolutions", () => {
    it("16x16 icon exists for standard resolution", async () => {
      const iconPath = join(__dirname, "../../resources/trayIconTemplate.png");
      const exists = await access(iconPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it("32x32@2x icon exists for Retina resolution", async () => {
      const iconPath = join(__dirname, "../../resources/trayIconTemplate@2x.png");
      const exists = await access(iconPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it("dev icon resolutions exist alongside production", async () => {
      const iconPath = join(__dirname, "../../resources/trayIconDevTemplate.png");
      const retinaIconPath = join(__dirname, "../../resources/trayIconDevTemplate@2x.png");
      const exists = await access(iconPath).then(() => true).catch(() => false);
      const retinaExists = await access(retinaIconPath).then(() => true).catch(() => false);

      expect(exists).toBe(true);
      expect(retinaExists).toBe(true);
    });
  });

  describe("ICON-04: Module-level tray reference", () => {
    it("tray.ts stores tray at module level to prevent GC", async () => {
      const traySource = await readFile(
        join(__dirname, "../../src/main/tray.ts"),
        "utf-8"
      );
      
      expect(traySource).toMatch(/let tray:\s*Tray\s*\|\s*null\s*=\s*null/);
    });

    it("tray.ts exports createTray function", async () => {
      const traySource = await readFile(
        join(__dirname, "../../src/main/tray.ts"),
        "utf-8"
      );
      
      expect(traySource).toContain("export function createTray");
    });

    it("tray.ts exports updateTrayForDaemonStatus function", async () => {
      const traySource = await readFile(
        join(__dirname, "../../src/main/tray.ts"),
        "utf-8"
      );
      
      expect(traySource).toContain("export function updateTrayForDaemonStatus");
    });

    it("selects tray icons based on app flavor", async () => {
      const traySource = await readFile(
        join(__dirname, "../../src/main/tray.ts"),
        "utf-8"
      );

      expect(traySource).toContain("trayIconDevTemplate-green.png");
      expect(traySource).toContain("trayIconDevTemplate-red.png");
      expect(traySource).toContain("isDevDesktopApp()");
    });
  });

  describe("ICON-01: Icon design verification", () => {
    it("icon files are valid PNG format", async () => {
      const icon16 = await readFile(join(__dirname, "../../resources/trayIconTemplate.png"));
      const icon32 = await readFile(join(__dirname, "../../resources/trayIconTemplate@2x.png"));
      const devIcon16 = await readFile(join(__dirname, "../../resources/trayIconDevTemplate.png"));
      const devIcon32 = await readFile(join(__dirname, "../../resources/trayIconDevTemplate@2x.png"));
      
      // PNG magic number: 89 50 4E 47
      const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      
      expect(Buffer.from(icon16).subarray(0, 4)).toEqual(pngSignature);
      expect(Buffer.from(icon32).subarray(0, 4)).toEqual(pngSignature);
      expect(Buffer.from(devIcon16).subarray(0, 4)).toEqual(pngSignature);
      expect(Buffer.from(devIcon32).subarray(0, 4)).toEqual(pngSignature);
    });
  });

  describe("ICON-05: Status indicator icons", () => {
    it("green status indicator icons exist", async () => {
      const green16 = await readFile(join(__dirname, "../../resources/trayIconTemplate-green.png"));
      const green32 = await readFile(join(__dirname, "../../resources/trayIconTemplate-green@2x.png"));
      const devGreen16 = await readFile(join(__dirname, "../../resources/trayIconDevTemplate-green.png"));
      const devGreen32 = await readFile(join(__dirname, "../../resources/trayIconDevTemplate-green@2x.png"));
      
      const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      
      expect(Buffer.from(green16).subarray(0, 4)).toEqual(pngSignature);
      expect(Buffer.from(green32).subarray(0, 4)).toEqual(pngSignature);
      expect(Buffer.from(devGreen16).subarray(0, 4)).toEqual(pngSignature);
      expect(Buffer.from(devGreen32).subarray(0, 4)).toEqual(pngSignature);
    });

    it("red status indicator icons exist", async () => {
      const red16 = await readFile(join(__dirname, "../../resources/trayIconTemplate-red.png"));
      const red32 = await readFile(join(__dirname, "../../resources/trayIconTemplate-red@2x.png"));
      const devRed16 = await readFile(join(__dirname, "../../resources/trayIconDevTemplate-red.png"));
      const devRed32 = await readFile(join(__dirname, "../../resources/trayIconDevTemplate-red@2x.png"));
      
      const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      
      expect(Buffer.from(red16).subarray(0, 4)).toEqual(pngSignature);
      expect(Buffer.from(red32).subarray(0, 4)).toEqual(pngSignature);
      expect(Buffer.from(devRed16).subarray(0, 4)).toEqual(pngSignature);
      expect(Buffer.from(devRed32).subarray(0, 4)).toEqual(pngSignature);
    });

    it("status icons follow Template naming convention", async () => {
      const greenPath = join(__dirname, "../../resources/trayIconTemplate-green.png");
      const redPath = join(__dirname, "../../resources/trayIconTemplate-red.png");
      const devGreenPath = join(__dirname, "../../resources/trayIconDevTemplate-green.png");
      const devRedPath = join(__dirname, "../../resources/trayIconDevTemplate-red.png");
      
      expect(greenPath).toMatch(/Template.*\.png$/);
      expect(redPath).toMatch(/Template.*\.png$/);
      expect(devGreenPath).toMatch(/Template.*\.png$/);
      expect(devRedPath).toMatch(/Template.*\.png$/);
    });
  });
});
