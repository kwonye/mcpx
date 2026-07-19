import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { mainPath, createSandbox, cleanupSandbox, closeApp, openDashboardWindow } from "./helpers";

test.describe("app launch", () => {
  test("electron app starts without errors", async () => {
    const sandbox = createSandbox();
    let app: ElectronApplication | undefined;

    try {
      app = await electron.launch({ args: [mainPath], env: sandbox.env });

      // The app should have at least one window (even if hidden)
      // or the tray should be created. We verify the app process is running.
      const isRunning = app.process().pid !== undefined;
      expect(isRunning).toBe(true);
    } finally {
      if (app) {
        await closeApp(app);
      }
      cleanupSandbox(sandbox);
    }
  });

  test("app launches 10 consecutive times without crashing", async () => {
    test.setTimeout(90000);

    const launchAttempts = 10;
    const sandbox = createSandbox();

    try {
      for (let i = 0; i < launchAttempts; i++) {
        // Launch the app
        const app = await electron.launch({ args: [mainPath], env: sandbox.env });

        try {
          // Verify the app process is running
          const isRunning = app.process().pid !== undefined;
          expect(isRunning).toBe(true);

          // Verify the app has a valid PID
          expect(app.process().pid).toBeDefined();
          expect(app.process().pid).toBeGreaterThan(0);
        } finally {
          // Close the app before next attempt
          await closeApp(app);
        }
      }
    } finally {
      cleanupSandbox(sandbox);
    }
  });
});

test.describe("dashboard window", () => {
  test("can open and render dashboard content", async () => {
    const sandbox = createSandbox();
    let app: ElectronApplication | undefined;

    try {
      app = await electron.launch({ args: [mainPath], env: sandbox.env });
      const window = await openDashboardWindow(app);

      // Verify the root element exists
      const root = await window.locator("#root").count();
      expect(root).toBe(1);
    } finally {
      if (app) {
        await closeApp(app);
      }
      cleanupSandbox(sandbox);
    }
  });
});
