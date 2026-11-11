import { test, expect } from "@playwright/test";
import { withDashboard } from "./helpers";

test.describe("render", () => {
  test("renders the dashboard shell with every section in the sidebar", async () => {
    test.setTimeout(60000);
    await withDashboard(async ({ window }) => {
      await expect(window.locator("#root")).toHaveCount(1);
      const nav = window.getByRole("navigation", { name: "Main" });
      for (const section of ["Servers", "Clients", "Add-ons", "Projects", "Settings"]) {
        await expect(nav.getByRole("button", { name: section })).toBeVisible();
      }
      await expect(window.getByRole("heading", { name: "Servers", level: 1 })).toBeVisible();
    });
  });

  test("loads no remote fonts, stylesheets or icon fonts", async () => {
    test.setTimeout(60000);
    await withDashboard(async ({ window }) => {
      await expect(window.locator('link[rel="stylesheet"][href^="http"]')).toHaveCount(0);
      const remote = await window.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => /^https?:/.test(name) && !name.includes("127.0.0.1") && !name.includes("localhost")));
      expect(remote).toEqual([]);
      // Icons are inline SVG, so they never render as ligature words offline.
      await expect(window.getByRole("navigation", { name: "Main" }).locator("svg").first()).toBeVisible();
    });
  });
});
