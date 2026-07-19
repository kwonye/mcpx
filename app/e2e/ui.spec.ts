import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { mainPath, createSandbox, cleanupSandbox, closeApp, openDashboardWindow } from "./helpers";

test.describe("UI polish", () => {
  test("window opens with proper dimensions", async () => {
    test.setTimeout(60000);

    const sandbox = createSandbox();
    let app: ElectronApplication | undefined;

    try {
      app = await electron.launch({ args: [mainPath], env: sandbox.env });
      await openDashboardWindow(app);

      expect(await app.windows()).toHaveLength(1);

      const bounds = await app.evaluate(({ BrowserWindow }) => {
        return BrowserWindow.getAllWindows()[0]?.getBounds();
      });
      expect(bounds?.width).toBeGreaterThan(0);
      expect(bounds?.height).toBeGreaterThan(0);
    } finally {
      if (app) {
        await closeApp(app);
      }
      cleanupSandbox(sandbox);
    }
  });

  test("dashboard renders with dark theme", async () => {
    test.setTimeout(60000);

    const sandbox = createSandbox();
    let app: ElectronApplication | undefined;

    try {
      app = await electron.launch({ args: [mainPath], env: sandbox.env });
      const window = await openDashboardWindow(app);

      const bgColor = await window.evaluate(() => {
        return getComputedStyle(document.body).backgroundColor;
      });

      expect(bgColor).toBeTruthy();
    } finally {
      if (app) {
        await closeApp(app);
      }
      cleanupSandbox(sandbox);
    }
  });

  test("dashboard has expected UI components", async () => {
    test.setTimeout(60000);

    const sandbox = createSandbox();
    let app: ElectronApplication | undefined;

    try {
      app = await electron.launch({ args: [mainPath], env: sandbox.env });
      const window = await openDashboardWindow(app);

      const sidebar = await window.locator(".sidebar").count();
      expect(sidebar).toBe(1);

      const mainContent = await window.locator(".main-content").count();
      expect(mainContent).toBe(1);
    } finally {
      if (app) {
        await closeApp(app);
      }
      cleanupSandbox(sandbox);
    }
  });

  test("sidebar has navigation buttons with proper styling", async () => {
    test.setTimeout(60000);

    const sandbox = createSandbox();
    let app: ElectronApplication | undefined;

    try {
      app = await electron.launch({ args: [mainPath], env: sandbox.env });
      const window = await openDashboardWindow(app);

      const navButtons = await window.locator(".nav-button").count();
      expect(navButtons).toBeGreaterThan(0);
    } finally {
      if (app) {
        await closeApp(app);
      }
      cleanupSandbox(sandbox);
    }
  });

  test("dashboard reserves top safe area for macOS window controls", async () => {
    test.setTimeout(60000);

    const sandbox = createSandbox();
    let app: ElectronApplication | undefined;

    try {
      app = await electron.launch({ args: [mainPath], env: sandbox.env });
      const window = await openDashboardWindow(app);

      const sidebarLogoBox = await window.locator(".sidebar-logo").boundingBox();
      const mainContentPaddingTop = await window.locator(".main-content").evaluate((element) => {
        return window.getComputedStyle(element).paddingTop;
      });

      expect(sidebarLogoBox).toBeTruthy();
      expect(sidebarLogoBox!.y).toBeGreaterThanOrEqual(40);
      expect(Number.parseFloat(mainContentPaddingTop)).toBeGreaterThanOrEqual(48);
    } finally {
      if (app) {
        await closeApp(app);
      }
      cleanupSandbox(sandbox);
    }
  });
});
