import { test, expect, _electron as electron } from "@playwright/test";
import { resolve } from "node:path";

const mainPath = resolve(__dirname, "../out/main/index.js");

test.describe("app launch", () => {
  test("electron app starts without errors", async () => {
    const app = await electron.launch({ args: [mainPath] });

    // The app should have at least one window (even if hidden)
    // or the tray should be created. We verify the app process is running.
    const isRunning = app.process().pid !== undefined;
    expect(isRunning).toBe(true);

    await app.close();
  });

  test("app launches 10 consecutive times without crashing", async () => {
    const launchAttempts = 10;
    
    for (let i = 0; i < launchAttempts; i++) {
      // Launch the app
      const app = await electron.launch({ args: [mainPath] });
      
      // Verify the app process is running
      const isRunning = app.process().pid !== undefined;
      expect(isRunning).toBe(true);
      
      // Verify the app has a valid PID
      expect(app.process().pid).toBeDefined();
      expect(app.process().pid).toBeGreaterThan(0);
      
      // Close the app before next attempt
      await app.close();
    }
  });
});

test.describe("dashboard window", () => {
  test("can open and render dashboard content", async () => {
    const app = await electron.launch({ args: [mainPath] });

    // Evaluate in main process to open a dashboard window
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = new BrowserWindow({
        width: 900,
        height: 650,
        webPreferences: { sandbox: false }
      });
      const path = require("node:path");
      const indexPath = path.join(__dirname, "../renderer/index.html");
      await win.loadFile(indexPath, { hash: "dashboard" });
    });

    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // Verify the root element exists
    const root = await window.locator("#root").count();
    expect(root).toBe(1);

    await app.close();
  });
});
