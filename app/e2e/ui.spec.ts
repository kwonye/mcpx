import { test, expect } from "@playwright/test";
import { goTo, withDashboard } from "./helpers";

test.describe("dashboard UI", () => {
  test("navigates every section by role and name", async () => {
    test.setTimeout(60000);
    await withDashboard(async ({ window }) => {
      await goTo(window, "Clients");
      await expect(window.getByRole("button", { name: "Sync now" })).toBeVisible();
      await goTo(window, "Add-ons");
      for (const tab of ["Installed", "Discover", "Skills", "Sources"]) {
        await expect(window.getByRole("tab", { name: new RegExp(`^${tab}`) })).toBeVisible();
      }
      await expect(window.getByRole("button", { name: "Import / export environment" })).toBeVisible();
      await goTo(window, "Projects");
      await expect(window.getByRole("button", { name: "Add project" }).first()).toBeVisible();
      await goTo(window, "Settings");
      await expect(window.getByRole("switch", { name: "Start at login" })).toBeVisible();
      await goTo(window, "Servers");
    });
  });

  test("the privacy choice never blocks the dashboard", async () => {
    test.setTimeout(60000);
    await withDashboard(async ({ window }) => {
      // With or without the first-run notice the sections stay usable.
      await goTo(window, "Settings");
      await expect(window.getByRole("region", { name: "Privacy & diagnostics" })).toBeVisible();
    });
  });

  test("window chrome matches the platform", async () => {
    test.setTimeout(60000);
    await withDashboard(async ({ window }) => {
      const platform = await window.evaluate(() => document.documentElement.dataset.platform);
      expect(platform).toBe(process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux");
      if (process.platform === "darwin") {
        // The sidebar header clears the traffic lights (78px gutter).
        const brand = await window.locator(".sidebar__brand").boundingBox();
        expect(brand!.height).toBeGreaterThanOrEqual(44);
        const paddingLeft = await window.locator(".sidebar__brand").evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingLeft));
        expect(paddingLeft).toBeGreaterThanOrEqual(70);
      } else if (process.platform === "win32") {
        const titlebar = await window.locator(".titlebar").boundingBox();
        expect(titlebar!.height).toBe(40);
      } else {
        await expect(window.locator(".titlebar")).toHaveCount(0);
      }
    });
  });
});
