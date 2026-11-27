import { test, expect } from "@playwright/test";
import { openDashboardWindow, withDashboard } from "./helpers";

/**
 * Lifecycle contract of the cross-platform shell: the dashboard opens on a
 * normal launch, closing it hides it (the app keeps running in the tray),
 * and activating the app shows it again.
 */
test.describe("lifecycle", () => {
  test("closing the dashboard hides it without quitting, and activate shows it again", async () => {
    test.setTimeout(60000);
    await withDashboard(async ({ app }) => {
      const pid = app.process().pid;
      // Renderer visibility does not mean the native window has reached ready-to-show.
      await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((win) => win.webContents.getURL().includes("#dashboard") && win.isVisible())
      )).toBe(true);
      await app.evaluate(({ BrowserWindow }) => {
        const dashboard = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes("#dashboard"));
        if (!dashboard) throw new Error("Dashboard window was not found");
        dashboard.close();
      });
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((win) => win.isVisible()).length)).toBe(0);
      expect(app.process().exitCode).toBeNull();
      expect(app.process().pid).toBe(pid);

      await app.evaluate(({ app }) => { app.emit("activate"); });
      const reopened = await openDashboardWindow(app);
      await expect(reopened.getByRole("navigation", { name: "Main" })).toBeVisible();
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((win) => win.isVisible()))).toBe(true);
    });
  });

  test("main-process navigation reaches the renderer", async () => {
    test.setTimeout(60000);
    await withDashboard(async ({ app, window }) => {
      await app.evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send("navigate", "clients");
      });
      await expect(window.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();
    });
  });
});
