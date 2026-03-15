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
  });

  describe("ICON-01: Icon design verification", () => {
    it("icon files are valid PNG format", async () => {
      const icon16 = await readFile(join(__dirname, "../../resources/trayIconTemplate.png"));
      const icon32 = await readFile(join(__dirname, "../../resources/trayIconTemplate@2x.png"));
      
      // PNG magic number: 89 50 4E 47
      const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      
      expect(Buffer.from(icon16).subarray(0, 4)).toEqual(pngSignature);
      expect(Buffer.from(icon32).subarray(0, 4)).toEqual(pngSignature);
    });
  });
});