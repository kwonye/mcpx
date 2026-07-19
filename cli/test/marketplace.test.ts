import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addMarketplace, inspectMarketplacePlugin, installMarketplacePlugin, listMarketplacePlugins, listMarketplaces, removeMarketplace } from "../src/core/marketplace.js";
import { loadConfig } from "../src/core/config.js";
import { PluginCache } from "../src/core/plugin-cache.js";
import { PluginManager } from "../src/core/plugin-manager.js";
import { runMarketplaceAutoUpdate } from "../src/core/marketplace-updater.js";
import { setupTempEnv } from "./helpers.js";

function writeJson(target: string, value: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2));
}

function writeText(target: string, value: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
}

describe("plugin marketplaces", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
  });

  it("injects the Anthropic and OpenAI defaults without a config migration", async () => {
    const env = setupTempEnv("mcpx-marketplace-defaults-");
    cleanups.push(env.restore);
    const marketplaces = await listMarketplaces();
    expect(marketplaces.map((entry) => entry.name)).toContain("claude-plugins-official");
    expect(marketplaces.map((entry) => entry.name)).toContain("openai-curated");
    expect(marketplaces.every((entry) => entry.builtIn && entry.autoUpdate)).toBe(true);
    expect(marketplaces.every((entry) => entry.sourceType === "github")).toBe(true);
  });

  it("adds and installs a Claude marketplace plugin with provenance", async () => {
    const env = setupTempEnv("mcpx-marketplace-claude-");
    cleanups.push(env.restore);
    process.env.MCPX_NO_UPDATE = "1";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpx-claude-catalog-"));
    cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
    writeJson(path.join(root, ".claude-plugin", "marketplace.json"), {
      name: "team-tools",
      owner: { name: "Team" },
      plugins: [{ name: "reviewer", source: "./plugins/reviewer", description: "Review changes" }],
    });
    writeJson(path.join(root, "plugins", "reviewer", ".claude-plugin", "plugin.json"), { name: "reviewer", version: "1.2.0" });
    writeText(path.join(root, "plugins", "reviewer", "skills", "review", "SKILL.md"), "---\ndescription: Review changes\n---\nReview this change.");

    await addMarketplace(root);
    const listings = await listMarketplacePlugins();
    expect(listings.find((entry) => entry.id === "reviewer@team-tools")?.supportedCapabilities).toContain("skills");
    const installed = await installMarketplacePlugin("reviewer@team-tools");
    expect(installed.marketplace).toMatchObject({ name: "team-tools", pluginName: "reviewer" });
    expect(loadConfig().plugins?.[installed.id]?.marketplace?.sourceFingerprint).toBeTruthy();
  });

  it("parses Codex manifests, registers HTTP MCP servers, and marks app-only plugins incompatible", async () => {
    const env = setupTempEnv("mcpx-marketplace-codex-");
    cleanups.push(env.restore);
    process.env.MCPX_NO_UPDATE = "1";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpx-codex-catalog-"));
    cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
    writeJson(path.join(root, ".agents", "plugins", "marketplace.json"), {
      name: "codex-team",
      interface: { displayName: "Codex Team" },
      plugins: [
        { name: "notion-like", source: { source: "local", path: "./plugins/notion-like" }, category: "Productivity", policy: { installation: "AVAILABLE" } },
        { name: "app-only", source: { source: "local", path: "./plugins/app-only" }, category: "Productivity", policy: { installation: "AVAILABLE" } },
      ],
    });
    writeJson(path.join(root, "plugins", "notion-like", ".codex-plugin", "plugin.json"), { name: "notion-like", version: "1.0.0", skills: "./skills", mcpServers: "./.mcp.json", apps: "./.app.json" });
    writeText(path.join(root, "plugins", "notion-like", "skills", "search", "SKILL.md"), "# Search");
    writeJson(path.join(root, "plugins", "notion-like", ".mcp.json"), { mcpServers: { notion: { type: "http", url: "https://mcp.example.test/mcp" } } });
    writeJson(path.join(root, "plugins", "notion-like", ".app.json"), { apps: { notion: { id: "connector_test" } } });
    writeJson(path.join(root, "plugins", "app-only", ".codex-plugin", "plugin.json"), { name: "app-only", version: "1.0.0", apps: "./.app.json" });
    writeJson(path.join(root, "plugins", "app-only", ".app.json"), { apps: { demo: { id: "connector_demo" } } });

    await addMarketplace(root, ".agents/plugins/marketplace.json");
    const appOnly = await inspectMarketplacePlugin("app-only@codex-team");
    expect(appOnly.compatible).toBe(false);
    expect(appOnly.unsupportedCapabilities).toContain("apps");

    const detail = await inspectMarketplacePlugin("notion-like@codex-team");
    expect(detail.supportedCapabilities).toContain("mcpServers");
    expect(detail.unsupportedCapabilities).toContain("apps");
    const installed = await installMarketplacePlugin("notion-like@codex-team");
    expect(loadConfig().servers[`${installed.name}__notion`]).toMatchObject({ transport: "http", url: "https://mcp.example.test/mcp" });
  });

  it("protects built-in marketplaces from removal", async () => {
    const env = setupTempEnv("mcpx-marketplace-remove-");
    cleanups.push(env.restore);
    await expect(removeMarketplace("openai-curated")).rejects.toThrow("cannot be removed");
  });

  it("rejects marketplace-relative plugin paths that escape through a symlink", async () => {
    const env = setupTempEnv("mcpx-marketplace-containment-");
    cleanups.push(env.restore);
    process.env.MCPX_NO_UPDATE = "1";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpx-marketplace-root-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "mcpx-marketplace-outside-"));
    cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
    cleanups.push(() => fs.rmSync(outside, { recursive: true, force: true }));
    writeJson(path.join(root, ".claude-plugin", "marketplace.json"), {
      name: "escape-test",
      owner: { name: "Test" },
      plugins: [{ name: "escape", source: "./plugins/escape" }],
    });
    writeJson(path.join(outside, ".claude-plugin", "plugin.json"), { name: "escape", version: "1.0.0" });
    fs.mkdirSync(path.join(root, "plugins"), { recursive: true });
    fs.symlinkSync(outside, path.join(root, "plugins", "escape"), "dir");

    await addMarketplace(root);
    await expect(inspectMarketplacePlugin("escape@escape-test")).rejects.toThrow("escapes its snapshot");
  });

  it("checks out the requested git ref instead of the repository default branch", async () => {
    const env = setupTempEnv("mcpx-plugin-git-ref-");
    cleanups.push(env.restore);
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "mcpx-plugin-repo-"));
    cleanups.push(() => fs.rmSync(repo, { recursive: true, force: true }));
    execFileSync("git", ["init", "-b", "main"], { cwd: repo });
    writeJson(path.join(repo, ".claude-plugin", "plugin.json"), { name: "git-plugin", version: "1.0.0" });
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "first"], { cwd: repo });
    const firstSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
    execFileSync("git", ["tag", "v1"], { cwd: repo });
    writeJson(path.join(repo, ".claude-plugin", "plugin.json"), { name: "git-plugin", version: "2.0.0" });
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "second"], { cwd: repo });

    const cached = await new PluginCache().fetch({ type: "git", original: repo, ref: "v1" }, "git-plugin");
    expect(JSON.parse(fs.readFileSync(path.join(cached.root, ".claude-plugin", "plugin.json"), "utf8")).version).toBe("1.0.0");

    const inspected = await new PluginManager().inspectResolvedSource({ type: "git", original: repo, resolvedSha: firstSha });
    expect(inspected.sha).toBe(firstSha);
    expect(inspected.manifest?.version).toBe("1.0.0");
  });

  it("does not run automatic marketplace updates when updates are disabled", async () => {
    const env = setupTempEnv("mcpx-marketplace-updater-disabled-");
    cleanups.push(env.restore);
    process.env.MCPX_NO_UPDATE = "1";
    expect(await runMarketplaceAutoUpdate({ force: true })).toEqual({ checked: [], errors: [], skipped: true });
  });
});
