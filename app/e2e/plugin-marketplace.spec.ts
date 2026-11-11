import { test, expect, type Page } from "@playwright/test";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { goTo, readConfig, withDashboard } from "./helpers";

async function openTab(window: Page, name: string) {
  await window.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
}

async function pluginMenu(window: Page, plugin: string, item: string | RegExp) {
  await window.getByRole("button", { name: `More actions for ${plugin}` }).click();
  await window.getByRole("menuitem", { name: item }).click();
}

test("installs and customizes a complete standard Agent Skill without vendor formats", async () => {
  test.setTimeout(90_000);
  const source = mkdtempSync(join(tmpdir(), "mcpx-standard-skill-e2e-"));
  const skillRoot = join(source, "review");
  mkdirSync(join(skillRoot, "references"), { recursive: true });
  writeFileSync(join(skillRoot, "SKILL.md"), '---\nname: "review"\ndescription: >\n  Review code\n  when requested.\n---\nRead references/checklist.md.');
  writeFileSync(join(skillRoot, "references/checklist.md"), "Check correctness and tests.");
  try {
    await withDashboard(async ({ window, sandbox }) => {
      await goTo(window, "Add-ons");
      await openTab(window, "Skills");
      await window.getByRole("button", { name: "Install…" }).first().click();
      const dialog = window.getByRole("dialog", { name: "Install a skill" });
      await dialog.getByRole("textbox", { name: "Source" }).fill(skillRoot);
      await dialog.getByRole("button", { name: "Install" }).click();
      await expect(window.getByRole("button", { name: "Make editable copy" })).toBeVisible({ timeout: 20_000 });
      await window.getByRole("button", { name: "Make editable copy" }).click();
      await expect(window.getByRole("button", { name: "Make editable copy" })).toHaveCount(0);
      const authored = join(sandbox.env.MCPX_CONFIG_HOME!, "mcpx/skills/review");
      await expect.poll(() => readFileSync(join(authored, "references/checklist.md"), "utf8")).toBe("Check correctness and tests.");
      await expect(window.getByRole("textbox", { name: "Contents of review" })).toHaveValue(/name: ["']?review/);
    });
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
});

test("rejects invalid skill names inline", async () => {
  test.setTimeout(60_000);
  await withDashboard(async ({ window }) => {
    await goTo(window, "Add-ons");
    await openTab(window, "Skills");
    await window.getByRole("button", { name: "New skill" }).first().click();
    const dialog = window.getByRole("dialog", { name: "New skill" });
    await dialog.getByRole("textbox", { name: "Name" }).fill("Bad_Name!");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(dialog.getByRole("alert")).toContainText("lowercase letters and numbers");
  });
});

test("manages a custom source and plugin end to end", async () => {
  test.setTimeout(120_000);
  const source = mkdtempSync(join(tmpdir(), "mcpx-marketplace-e2e-"));
  const catalog = join(source, ".cursor-plugin/marketplace.json");
  const manifest = join(source, "reviewer/.cursor-plugin/plugin.json");
  const skillRoot = join(source, "reviewer/skills/review");
  const revision = (version: string) => {
    writeFileSync(manifest, JSON.stringify({ name: "reviewer", displayName: "Review Assistant", version, skills: "./skills", rules: "./rules" }));
    writeFileSync(join(skillRoot, "SKILL.md"), `---\nname: review\ndescription: Review code\n---\nVersion ${version}. Read references/checklist.md.`);
  };
  mkdirSync(join(source, ".cursor-plugin"), { recursive: true });
  mkdirSync(join(source, "reviewer/.cursor-plugin"), { recursive: true });
  mkdirSync(join(skillRoot, "references"), { recursive: true });
  writeFileSync(catalog, JSON.stringify({ name: "team-tools", plugins: [{ name: "reviewer", source: "reviewer" }] }));
  writeFileSync(join(skillRoot, "references/checklist.md"), "Check correctness.");
  revision("1.0.0");
  try {
    await withDashboard(async ({ window, sandbox }) => {
      mkdirSync(join(sandbox.env.HOME!, ".codex"), { recursive: true });
      writeFileSync(join(sandbox.env.HOME!, ".codex/config.toml"), "");
      const config = () => readConfig(sandbox);

      await goTo(window, "Add-ons");
      await openTab(window, "Sources");
      const sources = window.getByRole("list", { name: "Sources" });
      for (const name of ["Claude official", "Codex official", "Cursor official"]) await expect(sources.getByRole("listitem").filter({ hasText: name })).toBeVisible();
      await window.getByRole("textbox", { name: "Add a source" }).fill(source);
      await window.getByRole("button", { name: "Add source" }).click();
      const teamRow = sources.getByRole("listitem").filter({ hasText: "team-tools" });
      await expect(teamRow).toBeVisible();

      await openTab(window, "Discover");
      await window.getByRole("button", { name: "Review Assistant details" }).click();
      const detail = window.getByRole("dialog", { name: "Review Assistant" });
      await expect(detail.getByText("rules", { exact: true })).toBeVisible();
      await detail.getByRole("button", { name: "Install", exact: true }).click();
      await expect(detail).toHaveCount(0, { timeout: 30_000 });
      await expect(window.getByRole("status").filter({ hasText: "Installed reviewer" })).toBeVisible();

      await openTab(window, "Installed");
      await expect(window.getByRole("button", { name: "reviewer details" })).toBeVisible();
      const id = Object.keys(config().plugins)[0];
      const projection = join(sandbox.env.HOME!, ".agents/skills/reviewer/review");
      expect(readFileSync(join(projection, "references/checklist.md"), "utf8")).toBe("Check correctness.");

      const enabled = window.getByRole("switch", { name: "reviewer enabled" });
      await enabled.click();
      await expect.poll(() => config().plugins[id].enabled).toBe(false);
      await expect(enabled).toHaveAttribute("aria-checked", "false");
      await expect.poll(() => existsSync(projection)).toBe(false);
      await enabled.click();
      await expect.poll(() => config().plugins[id].enabled).toBe(true);

      await pluginMenu(window, "reviewer", "Pin this version");
      await expect(window.getByText("Pinned", { exact: true })).toBeVisible();
      await window.getByRole("button", { name: "More actions for reviewer" }).click();
      await expect(window.getByRole("menuitem", { name: "Check for update" })).toBeDisabled();
      await window.getByRole("menuitem", { name: "Unpin version" }).click();
      await expect(window.getByText("Pinned", { exact: true })).toHaveCount(0);

      revision("2.0.0");
      await openTab(window, "Sources");
      await teamRow.getByRole("button", { name: /^Refresh/ }).click();
      await expect.poll(() => config().plugins[id].version).toBe("2.0.0");
      await openTab(window, "Installed");
      await expect(window.getByText("v2.0.0", { exact: true })).toBeVisible();
      await pluginMenu(window, "reviewer", /^Roll back to v1\.0\.0/);
      await expect(window.getByText("v1.0.0", { exact: true })).toBeVisible();

      await pluginMenu(window, "reviewer", "Uninstall");
      await window.getByRole("alertdialog", { name: "Uninstall reviewer?" }).getByRole("button", { name: "Uninstall" }).click();
      await expect(window.getByText("No plugins installed")).toBeVisible();
      expect(config().plugins[id]).toBeUndefined();
      expect(existsSync(projection)).toBe(false);
      expect(readFileSync(join(skillRoot, "SKILL.md"), "utf8")).toContain("Version 2.0.0");

      await openTab(window, "Sources");
      await teamRow.getByRole("button", { name: /^More actions for/ }).click();
      await window.getByRole("menuitem", { name: "Remove" }).click();
      await window.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
      await expect.poll(() => config().marketplaces["team-tools"]).toBeUndefined();
    });
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
});
