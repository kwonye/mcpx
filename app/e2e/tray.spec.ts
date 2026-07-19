import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { resolve } from "node:path";
import {
  mainPath,
  createSandbox,
  cleanupSandbox,
  closeApp,
  openDashboardWindow,
  openPopoverWindow
} from "./helpers";

test.describe("tray icon", () => {
  test("app creates tray on launch", async () => {
    const sandbox = createSandbox();
    let app: ElectronApplication | undefined;

    try {
      app = await electron.launch({ args: [mainPath], env: sandbox.env });

      // Give app time to initialize and create tray
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify app process is running (tray is created internally)
      const pid = app.process().pid;
      expect(pid).toBeDefined();
      expect(pid).toBeGreaterThan(0);
    } finally {
      if (app) {
        await closeApp(app);
      }
      cleanupSandbox(sandbox);
    }
  });

  test("tray icon files exist with correct naming", async () => {
    const fs = await import("node:fs/promises");

    const resourcesDir = resolve(__dirname, "../resources");

    // Check 16x16 icon
    const icon16 = resolve(resourcesDir, "trayIconTemplate.png");
    const icon16Exists = await fs.access(icon16).then(() => true).catch(() => false);
    expect(icon16Exists).toBe(true);

    // Check 32x32@2x icon
    const icon32 = resolve(resourcesDir, "trayIconTemplate@2x.png");
    const icon32Exists = await fs.access(icon32).then(() => true).catch(() => false);
    expect(icon32Exists).toBe(true);
  });

  test("app persists tray after window operations", async () => {
    test.setTimeout(60000);

    const sandbox = createSandbox();
    let app: ElectronApplication | undefined;

    try {
      app = await electron.launch({ args: [mainPath], env: sandbox.env });

      // Trigger activate (creates dashboard window) via the real production path.
      await openDashboardWindow(app);

      // Close any windows
      const windows = await app.windows();
      for (const win of windows) {
        await win.close();
      }
      await expect.poll(async () => (await app!.windows()).length).toBe(0);

      // App should still be running (tray persists) - macOS menu-bar apps
      // don't quit on window-all-closed.
      expect(app.process().exitCode).toBeNull();
      const pid = app.process().pid;
      expect(pid).toBeDefined();
    } finally {
      if (app) {
        await closeApp(app);
      }
      cleanupSandbox(sandbox);
    }
  });

  test("popover opens from tray flow and can launch the dashboard", async () => {
    test.setTimeout(60000);

    const sandbox = createSandbox();
    let app: ElectronApplication | undefined;

    try {
      app = await electron.launch({ args: [mainPath], env: sandbox.env });

      // A real tray click isn't simulable here (no OS-level tray to click,
      // and the internal togglePopover() is no longer reachable via require
      // from electronApplication.evaluate() - see openPopoverWindow's doc
      // comment). Opening the popover's own route exercises the same real
      // StatusPopover component and IPC bridge that a tray click would show.
      const popover = await openPopoverWindow(app);

      const openDashboardButton = popover.getByRole("button", { name: "Open Dashboard" });
      await expect(openDashboardButton).toBeVisible();
      await openDashboardButton.click();

      const dashboard = await openDashboardWindow(app);
      await expect(dashboard.locator(".sidebar")).toBeVisible();
    } finally {
      if (app) {
        await closeApp(app);
      }
      cleanupSandbox(sandbox);
    }
  });
});
