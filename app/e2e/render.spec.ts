import { test, expect, _electron as electron } from "@playwright/test";
import { resolve } from "node:path";

const mainPath = resolve(__dirname, "../out/main/index.js");
const indexPath = resolve(__dirname, "../out/renderer/index.html");

test.describe("render", () => {
  test("renders dashboard content with #root element", async () => {
    const app = await electron.launch({ args: [mainPath] });

    // Evaluate in main process to open a dashboard window
    await app.evaluate(async ({ BrowserWindow }, pathArgs: { indexPath: string }) => {
      const win = new BrowserWindow({
        width: 900,
        height: 650,
        webPreferences: { sandbox: false },
      });
      await win.loadFile(pathArgs.indexPath, { hash: "dashboard" });
    }, { indexPath });

    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // Give React time to hydrate
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify #root element exists
    const root = await window.locator("#root");
    await expect(root).toBeAttached();
    
    const rootCount = await root.count();
    expect(rootCount).toBe(1);

    // Verify React rendered something (not blank screen)
    const rootContent = await root.textContent();
    expect(rootContent).toBeTruthy();
    expect(rootContent!.length).toBeGreaterThan(0);

    await app.close();
  });

  test("dashboard has expected structure", async () => {
    const app = await electron.launch({ args: [mainPath] });

    await app.evaluate(async ({ BrowserWindow }, pathArgs: { indexPath: string }) => {
      const win = new BrowserWindow({
        width: 900,
        height: 650,
        webPreferences: { sandbox: false },
      });
      await win.loadFile(pathArgs.indexPath, { hash: "dashboard" });
    }, { indexPath });

    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify dashboard container renders
    const dashboard = await window.locator(".dashboard-container");
    await expect(dashboard).toBeAttached();
    
    // Should have either Loading text OR actual content
    const content = await dashboard.textContent();
    expect(content).toBeTruthy();

    await app.close();
  });
});
