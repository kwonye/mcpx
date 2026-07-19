import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mainPath, createSandbox, cleanupSandbox, closeApp, openDashboardWindow } from "./helpers";

function writeJson(target: string, value: unknown): void {
  writeFileSync(target, JSON.stringify(value, null, 2));
}

test("adds a local marketplace, discovers a plugin, and installs it", async () => {
  test.setTimeout(90_000);
  const sandbox = createSandbox();
  const marketplace = mkdtempSync(join(tmpdir(), "mcpx-marketplace-e2e-"));
  let app: ElectronApplication | undefined;

  try {
    mkdirSync(join(marketplace, ".claude-plugin"), { recursive: true });
    mkdirSync(join(marketplace, "plugins", "reviewer", ".claude-plugin"), { recursive: true });
    mkdirSync(join(marketplace, "plugins", "reviewer", "skills", "review"), { recursive: true });
    writeJson(join(marketplace, ".claude-plugin", "marketplace.json"), {
      name: "e2e-tools",
      owner: { name: "E2E" },
      plugins: [{ name: "reviewer", displayName: "Review Assistant", description: "Reviews code changes", source: "./plugins/reviewer", category: "Testing" }],
    });
    writeJson(join(marketplace, "plugins", "reviewer", ".claude-plugin", "plugin.json"), { name: "reviewer", version: "1.0.0" });
    writeFileSync(join(marketplace, "plugins", "reviewer", "skills", "review", "SKILL.md"), "---\ndescription: Review code\n---\nReview this change.");

    app = await electron.launch({ args: [mainPath], env: sandbox.env });
    const window = await openDashboardWindow(app);
    await window.getByRole("button", { name: "Plugins" }).click();
    await window.getByRole("tab", { name: "Marketplaces" }).click();
    await window.getByPlaceholder(/GitHub owner\/repo/).fill(marketplace);
    await window.getByRole("button", { name: "Add marketplace" }).click();
    await expect(window.getByText("e2e-tools", { exact: true })).toBeVisible({ timeout: 20_000 });

    await window.getByRole("tab", { name: "Discover" }).click();
    await window.getByRole("button", { name: /Review Assistant/ }).click();
    await expect(window.getByRole("dialog", { name: /Review Assistant details/ })).toBeVisible();
    window.once("dialog", (dialog) => dialog.accept());
    await window.getByRole("button", { name: "Install", exact: true }).click();

    await window.getByRole("tab", { name: /Installed/ }).click();
    await expect(window.getByText("reviewer", { exact: true })).toBeVisible({ timeout: 20_000 });
  } finally {
    if (app) await closeApp(app);
    cleanupSandbox(sandbox);
    rmSync(marketplace, { recursive: true, force: true });
  }
});
