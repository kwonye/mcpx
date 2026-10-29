import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mainPath, createSandbox, cleanupSandbox, closeApp, openDashboardWindow } from "./helpers";

test("installs and customizes a complete standard Agent Skill without vendor formats", async () => {
  test.setTimeout(90_000);
  const sandbox = createSandbox();
  const source = mkdtempSync(join(tmpdir(), "mcpx-standard-skill-e2e-"));
  const skillRoot = join(source, "review");
  let app: ElectronApplication | undefined;
  try {
    mkdirSync(join(skillRoot, "references"), { recursive: true });
    writeFileSync(join(skillRoot, "SKILL.md"), '---\nname: "review"\ndescription: >\n  Review code\n  when requested.\n---\nRead references/checklist.md.');
    writeFileSync(join(skillRoot, "references/checklist.md"), "Check correctness and tests.");
    const executablePath = process.env.MCPX_E2E_EXECUTABLE;
    app = await electron.launch({ ...(executablePath ? { executablePath } : {}), args: [...sandbox.launchArgs, ...(!executablePath ? [mainPath] : [])], env: sandbox.env });
    const window = await openDashboardWindow(app);
    await window.getByRole("button", { name: "Library" }).click();
    await window.getByRole("tab", { name: "Shared Skills" }).click();
    await window.getByRole("textbox", { name: "Agent Skill source" }).fill(skillRoot);
    await window.getByRole("button", { name: "Install Skill", exact: true }).click();
    await expect(window.getByRole("button", { name: "Customize", exact: true })).toBeVisible({ timeout: 20_000 });
    await window.getByRole("button", { name: "Customize", exact: true }).click();
    await expect(window.getByRole("button", { name: "Customize", exact: true })).toHaveCount(0);
    const authored = join(sandbox.env.MCPX_CONFIG_HOME!, "mcpx/skills/review");
    await expect.poll(() => readFileSync(join(authored, "references/checklist.md"), "utf8")).toBe("Check correctness and tests.");
    await expect(window.getByPlaceholder("Enter skill instructions...")).toHaveValue(/name: ["']?review/);
    await window.screenshot({ path: "/tmp/mcpx-standards-installed-library.png" });
  } finally {
    if (app) await closeApp(app);
    cleanupSandbox(sandbox);
    rmSync(source, { recursive: true, force: true });
  }
});

test("manages a custom marketplace and plugin in the installed app", async () => {
  test.setTimeout(90_000);
  const sandbox = createSandbox();
  const source = mkdtempSync(join(tmpdir(), "mcpx-marketplace-e2e-"));
  let app: ElectronApplication | undefined;
  const catalog = join(source, ".cursor-plugin/marketplace.json");
  const manifest = join(source, "reviewer/.cursor-plugin/plugin.json");
  const skillRoot = join(source, "reviewer/skills/review");
  const configPath = join(sandbox.env.MCPX_CONFIG_HOME!, "mcpx/config.json");
  const config = () => JSON.parse(readFileSync(configPath, "utf8"));
  const revision = (version: string) => {
    writeFileSync(manifest, JSON.stringify({ name: "reviewer", displayName: "Review Assistant", version, skills: "./skills", rules: "./rules" }));
    writeFileSync(join(skillRoot, "SKILL.md"), `---\nname: review\ndescription: Review code\n---\nVersion ${version}. Read references/checklist.md.`);
  };
  try {
    mkdirSync(join(source, ".cursor-plugin"), { recursive: true });
    mkdirSync(join(source, "reviewer/.cursor-plugin"), { recursive: true });
    mkdirSync(join(skillRoot, "references"), { recursive: true });
    writeFileSync(catalog, JSON.stringify({ name: "team-tools", plugins: [{ name: "reviewer", source: "reviewer" }] }));
    writeFileSync(join(skillRoot, "references/checklist.md"), "Check correctness.");
    revision("1.0.0");
    mkdirSync(join(sandbox.env.HOME!, ".codex"), { recursive: true });
    writeFileSync(join(sandbox.env.HOME!, ".codex/config.toml"), "");
    const executablePath = process.env.MCPX_E2E_EXECUTABLE;
    app = await electron.launch({ ...(executablePath ? { executablePath } : {}), args: [...sandbox.launchArgs, ...(!executablePath ? [mainPath] : [])], env: sandbox.env });
    const window = await openDashboardWindow(app);
    await window.getByRole("button", { name: "Library" }).click();
    await window.getByRole("tab", { name: "Marketplaces" }).click();
    for (const name of ["Claude official", "Codex official", "Cursor official"]) await expect(window.getByText(name, { exact: true })).toBeVisible();
    await window.getByPlaceholder(/local path, or marketplace.json URL/).fill(source);
    await window.getByRole("button", { name: "Add marketplace", exact: true }).click();
    await expect(window.getByText("team-tools", { exact: true })).toBeVisible();
    await window.getByRole("tab", { name: "Discover", exact: true }).click();
    await window.getByRole("button", { name: /Review Assistant/ }).click();
    const detail = window.getByRole("dialog", { name: "Review Assistant details" });
    await expect(detail.getByText("rules", { exact: true })).toBeVisible();
    await detail.getByRole("button", { name: "Install", exact: true }).click();
    await expect(detail).toHaveCount(0);
    await window.getByRole("tab", { name: /Installed/ }).click();
    await expect(window.getByText("reviewer", { exact: true })).toBeVisible();
    const id = Object.keys(config().plugins)[0];
    const projection = join(sandbox.env.HOME!, ".agents/skills/reviewer/review");
    expect(readFileSync(join(projection, "references/checklist.md"), "utf8")).toBe("Check correctness.");
    await window.getByRole("checkbox").click();
    await expect.poll(() => config().plugins[id].enabled).toBe(false);
    await expect(window.getByRole("checkbox")).not.toBeChecked();
    await expect.poll(() => existsSync(projection)).toBe(false);
    await window.getByRole("checkbox").click();
    await expect.poll(() => config().plugins[id].enabled).toBe(true);
    await expect(window.getByRole("checkbox")).toBeChecked();
    await window.getByRole("button", { name: "More", exact: true }).click();
    await window.getByRole("button", { name: "Pin", exact: true }).click();
    await expect(window.getByRole("button", { name: "Unpin", exact: true })).toBeVisible();
    await expect(window.getByRole("button", { name: "Update", exact: true })).toBeDisabled();
    await window.getByRole("button", { name: "Unpin", exact: true }).click();
    await expect(window.getByRole("button", { name: "Pin", exact: true })).toBeVisible();
    revision("2.0.0");
    await window.getByRole("tab", { name: "Marketplaces" }).click();
    await window.locator(".marketplace-card").filter({ hasText: "team-tools" }).getByRole("button", { name: "Refresh", exact: true }).click();
    await expect.poll(() => config().plugins[id].version).toBe("2.0.0");
    await window.getByRole("tab", { name: /Installed/ }).click();
    await expect(window.getByText("v2.0.0", { exact: true })).toBeVisible();
    await window.getByRole("button", { name: "Rollback", exact: true }).click();
    await expect(window.getByText("v1.0.0", { exact: true })).toBeVisible();
    await window.screenshot({ path: "/tmp/mcpx-plugin-management-installed.png" });
    await window.getByRole("button", { name: "Uninstall", exact: true }).click();
    await window.getByRole("dialog", { name: "Uninstall plugin?" }).getByRole("button", { name: "Uninstall", exact: true }).click();
    await expect(window.getByText("No plugins installed.")).toBeVisible();
    expect(config().plugins[id]).toBeUndefined();
    expect(existsSync(projection)).toBe(false);
    expect(readFileSync(join(skillRoot, "SKILL.md"), "utf8")).toContain("Version 2.0.0");
    await window.getByRole("tab", { name: "Marketplaces" }).click();
    await window.locator(".marketplace-card").filter({ hasText: "team-tools" }).getByRole("button", { name: "Remove", exact: true }).click();
    await window.getByRole("dialog", { name: "Remove marketplace?" }).getByRole("button", { name: "Remove", exact: true }).click();
    await expect.poll(() => config().marketplaces["team-tools"]).toBeUndefined();
  } finally {
    if (app) await closeApp(app);
    cleanupSandbox(sandbox);
    rmSync(source, { recursive: true, force: true });
  }
});
