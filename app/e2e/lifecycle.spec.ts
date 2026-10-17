import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { mainPath, createSandbox, cleanupSandbox, closeApp, openDashboardWindow } from "./helpers";

test.describe("window-all-closed", () => {
  test("closing window doesn't quit app (process still running)", async () => {
    test.setTimeout(60000);

    const sandbox = createSandbox();
    let app: ElectronApplication | undefined;

    try {
      app = await electron.launch({ args: [mainPath], env: sandbox.env });

      const pid = app.process().pid;
      expect(pid).toBeDefined();

      // Trigger window creation via the real production activate path.
      const window = await openDashboardWindow(app);

      // Close the window.
      await window.close();

      // Wait for window-all-closed handling - app should still be running
      // (macOS behavior: menu-bar apps don't quit when their last window closes).
      await expect.poll(async () => (await app!.windows()).length).toBe(0);
      expect(app.process().pid).toBe(pid);
      expect(app.process().exitCode).toBeNull();
    } finally {
      if (app) {
        await closeApp(app);
      }
      cleanupSandbox(sandbox);
    }
  });
});

test.describe("activate", () => {
  test("activate event creates window when none exist", async () => {
    test.setTimeout(60000);

    const sandbox = createSandbox();
    let app: ElectronApplication | undefined;

    try {
      app = await electron.launch({ args: [mainPath], env: sandbox.env });

      // Initially no windows (menu bar app).
      expect((await app.windows()).length).toBe(0);

      // Trigger activate (dock click) via the real production path.
      let window = await openDashboardWindow(app);
      expect((await app.windows()).length).toBeGreaterThan(0);

      // Close the window.
      await window.close();
      await expect.poll(async () => (await app!.windows()).length).toBe(0);

      // Trigger activate again and verify the window is recreated.
      window = await openDashboardWindow(app);
      expect((await app.windows()).length).toBeGreaterThan(0);
    } finally {
      if (app) {
        await closeApp(app);
      }
      cleanupSandbox(sandbox);
    }
  });
});

test.describe("before-quit", () => {
  test("app starts and can be terminated", async () => {
    test.setTimeout(60000);

    const sandbox = createSandbox();
    let app: ElectronApplication | undefined;

    try {
      app = await electron.launch({ args: [mainPath], env: sandbox.env });

      const pid = app.process().pid;
      expect(pid).toBeDefined();

      // Create window to verify full lifecycle.
      await openDashboardWindow(app);
      expect((await app.windows()).length).toBeGreaterThan(0);

      // Full quit behavior is covered by main-process menu/tray tests;
      // termination itself happens via closeApp() below.
    } finally {
      if (app) {
        await closeApp(app);
      }
      cleanupSandbox(sandbox);
    }
  });
});
