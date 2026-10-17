import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { mainPath, createSandbox, cleanupSandbox, closeApp, openDashboardWindow } from "./helpers";

test.describe("render", () => {
  test("renders dashboard content with #root element", async () => {
    const sandbox = createSandbox();
    let app: ElectronApplication | undefined;

    try {
      app = await electron.launch({ args: [mainPath], env: sandbox.env });
      const window = await openDashboardWindow(app);

      // Verify #root element exists
      const root = window.locator("#root");
      await expect(root).toBeAttached();

      const rootCount = await root.count();
      expect(rootCount).toBe(1);

      // Verify React rendered something (not blank screen)
      const rootContent = await root.textContent();
      expect(rootContent).toBeTruthy();
      expect(rootContent!.length).toBeGreaterThan(0);
    } finally {
      if (app) {
        await closeApp(app);
      }
      cleanupSandbox(sandbox);
    }
  });

  test("dashboard has expected structure", async () => {
    const sandbox = createSandbox();
    let app: ElectronApplication | undefined;

    try {
      app = await electron.launch({ args: [mainPath], env: sandbox.env });
      const window = await openDashboardWindow(app);

      // Verify dashboard container renders
      const dashboard = window.locator(".dashboard-container");
      await expect(dashboard).toBeAttached();

      // Should have either Loading text OR actual content
      const content = await dashboard.textContent();
      expect(content).toBeTruthy();
    } finally {
      if (app) {
        await closeApp(app);
      }
      cleanupSandbox(sandbox);
    }
  });
});
