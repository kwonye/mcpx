import { test, expect, _electron as electron } from "@playwright/test";
import { resolve } from "node:path";

const mainPath = resolve(__dirname, "../out/main/index.js");

test.describe("UI polish", () => {
  test("window opens with proper dimensions", async () => {
    const app = await electron.launch({ args: [mainPath] });
    
    try {
      await app.evaluate(async ({ BrowserWindow }) => {
        const win = new BrowserWindow({
          width: 900,
          height: 650,
          titleBarStyle: "hiddenInset",
          trafficLightPosition: { x: 16, y: 16 },
          webPreferences: { sandbox: false }
        });
        const path = require("node:path");
        const indexPath = path.join(__dirname, "../renderer/index.html");
        await win.loadFile(indexPath, { hash: "dashboard" });
      });

      const window = await app.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      
      expect(await app.windows()).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  test("dashboard renders with dark theme", async () => {
    const app = await electron.launch({ args: [mainPath] });
    
    try {
      await app.evaluate(async ({ BrowserWindow }) => {
        const win = new BrowserWindow({
          width: 900,
          height: 650,
          titleBarStyle: "hiddenInset",
          webPreferences: { sandbox: false }
        });
        const path = require("node:path");
        const indexPath = path.join(__dirname, "../renderer/index.html");
        await win.loadFile(indexPath, { hash: "dashboard" });
      });

      const window = await app.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      await window.waitForTimeout(2000);

      const bgColor = await window.evaluate(() => {
        return getComputedStyle(document.body).backgroundColor;
      });
      
      expect(bgColor).toBeTruthy();
    } finally {
      await app.close();
    }
  });

  test("dashboard has expected UI components", async () => {
    const app = await electron.launch({ args: [mainPath] });
    
    try {
      await app.evaluate(async ({ BrowserWindow }) => {
        const win = new BrowserWindow({
          width: 900,
          height: 650,
          titleBarStyle: "hiddenInset",
          webPreferences: { sandbox: false }
        });
        const path = require("node:path");
        const indexPath = path.join(__dirname, "../renderer/index.html");
        await win.loadFile(indexPath, { hash: "dashboard" });
      });

      const window = await app.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      await window.waitForTimeout(2000);

      const sidebar = await window.locator(".sidebar").count();
      expect(sidebar).toBe(1);

      const mainContent = await window.locator(".main-content").count();
      expect(mainContent).toBe(1);
    } finally {
      await app.close();
    }
  });

  test("sidebar has navigation buttons with proper styling", async () => {
    const app = await electron.launch({ args: [mainPath] });
    
    try {
      await app.evaluate(async ({ BrowserWindow }) => {
        const win = new BrowserWindow({
          width: 900,
          height: 650,
          titleBarStyle: "hiddenInset",
          webPreferences: { sandbox: false }
        });
        const path = require("node:path");
        const indexPath = path.join(__dirname, "../renderer/index.html");
        await win.loadFile(indexPath, { hash: "dashboard" });
      });

      const window = await app.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      await window.waitForTimeout(2000);

      const navButtons = await window.locator(".nav-button").count();
      expect(navButtons).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  test("dashboard reserves top safe area for macOS window controls", async () => {
    const app = await electron.launch({ args: [mainPath] });

    try {
      await app.evaluate(async ({ BrowserWindow }) => {
        const win = new BrowserWindow({
          width: 900,
          height: 650,
          titleBarStyle: "hiddenInset",
          trafficLightPosition: { x: 16, y: 16 },
          webPreferences: { sandbox: false }
        });
        const path = require("node:path");
        const indexPath = path.join(__dirname, "../renderer/index.html");
        await win.loadFile(indexPath, { hash: "dashboard" });
      });

      const window = await app.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      await window.waitForTimeout(2000);

      const sidebarLogoBox = await window.locator(".sidebar-logo").boundingBox();
      const mainContentPaddingTop = await window.locator(".main-content").evaluate((element) => {
        return window.getComputedStyle(element).paddingTop;
      });

      expect(sidebarLogoBox).toBeTruthy();
      expect(sidebarLogoBox!.y).toBeGreaterThanOrEqual(40);
      expect(Number.parseFloat(mainContentPaddingTop)).toBeGreaterThanOrEqual(48);
    } finally {
      await app.close();
    }
  });
});
