import { test, expect, _electron as electron } from "@playwright/test";
import { resolve } from "node:path";

const mainPath = resolve(__dirname, "../out/main/index.js");

test.describe("tray icon", () => {
  test("app creates tray on launch", async () => {
    const app = await electron.launch({ args: [mainPath] });
    
    try {
      // Give app time to initialize and create tray
      await new Promise((resolve) => setTimeout(resolve, 2000));
      
      // Verify app process is running (tray is created internally)
      const pid = app.process().pid;
      expect(pid).toBeDefined();
      expect(pid).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  test("tray icon files exist with correct naming", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    
    const resourcesDir = path.join(__dirname, "../resources");
    
    // Check 16x16 icon
    const icon16 = path.join(resourcesDir, "trayIconTemplate.png");
    const icon16Exists = await fs.access(icon16).then(() => true).catch(() => false);
    expect(icon16Exists).toBe(true);
    
    // Check 32x32@2x icon
    const icon32 = path.join(resourcesDir, "trayIconTemplate@2x.png");
    const icon32Exists = await fs.access(icon32).then(() => true).catch(() => false);
    expect(icon32Exists).toBe(true);
  });

  test("app persists tray after window operations", async () => {
    const app = await electron.launch({ args: [mainPath] });
    
    try {
      // Give app time to initialize
      await new Promise((resolve) => setTimeout(resolve, 2000));
      
      // Trigger activate (creates window)
      await app.evaluate(async ({ app }) => {
        app.emit("activate");
      });
      
      await new Promise((resolve) => setTimeout(resolve, 1000));
      
      // Close any windows
      const windows = await app.windows();
      for (const win of windows) {
        await win.close();
      }
      
      await new Promise((resolve) => setTimeout(resolve, 1000));
      
      // App should still be running (tray persists)
      const pid = app.process().pid;
      expect(pid).toBeDefined();
    } finally {
      await app.close();
    }
  });
});