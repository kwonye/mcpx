import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addMarketplace, inspectMarketplacePlugin, installMarketplacePlugin, listMarketplacePlugins, listMarketplaces, removeMarketplace, refreshMarketplaceWithPlugins, updateMarketplaceInstalledPlugin } from "../src/core/marketplace.js";
import { loadConfig } from "../src/core/config.js";
import { PluginCache } from "../src/core/plugin-cache.js";
import { PluginManager, pinPlugin, unpinPlugin, rollbackPlugin, disablePlugin, enablePlugin, uninstallPlugin } from "../src/core/plugin-manager.js";
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

  it("injects Claude, Codex, and Cursor defaults without a config migration", async () => {
    const env = setupTempEnv("mcpx-marketplace-defaults-");
    cleanups.push(env.restore);
    const marketplaces = await listMarketplaces();
    expect(marketplaces.map((entry) => entry.name)).toContain("claude-plugins-official");
    expect(marketplaces.map((entry) => entry.name)).toContain("openai-curated");
    expect(marketplaces.map(entry => entry.name)).toContain("cursor-plugins");
    expect(marketplaces.every((entry) => entry.builtIn && !entry.autoUpdate)).toBe(true);
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
    writeText(path.join(root, "plugins", "reviewer", "skills", "review", "SKILL.md"), "---\nname: review\ndescription: Review changes\n---\nReview this change.");

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
    writeText(path.join(root, "plugins", "notion-like", "skills", "search", "SKILL.md"), "---\nname: search\ndescription: Search documents\n---\n# Search");
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
    writeText(path.join(repo, "skills/review/SKILL.md"), "---\nname: review\ndescription: Review\n---\nReview");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "first"], { cwd: repo });
    const firstSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
    execFileSync("git", ["tag", "v1"], { cwd: repo });
    writeJson(path.join(repo, ".claude-plugin", "plugin.json"), { name: "git-plugin", version: "2.0.0" });
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "second"], { cwd: repo });

    writeText(path.join(repo, "skills/review/SKILL.md"), "---\nname: review\ndescription: Review\n---\nReview");
    execFileSync("git", ["add", "."], { cwd: repo });
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

it("installs Cursor catalogs with bare relative sources and manages the plugin through its lifecycle", async () => {
  const env = setupTempEnv("cursor-marketplace-lifecycle-");
  process.env.MCPX_NO_UPDATE = "1";
  try {
    const root = path.join(env.root, "cursor-catalog");
    const skill = path.join(root, "reviewer/skills/review/SKILL.md");
    const manifest = path.join(root, "reviewer/.cursor-plugin/plugin.json");
    writeJson(path.join(root, ".cursor-plugin/marketplace.json"), { name: "cursor-team", owner: { name: "Team" }, plugins: [{ name: "reviewer", source: "reviewer" }] });
    writeJson(manifest, { name: "reviewer", version: "1", skills: "./skills", rules: "./rules" });
    writeText(skill, "---\nname: review\ndescription: Review code\n---\nVersion one");
    writeText(path.join(root, "reviewer/skills/review/references/checklist.md"), "Checklist");
    const marketplace = await addMarketplace(root);
    expect(marketplace.format).toBe("cursor");
    const detail = await inspectMarketplacePlugin("reviewer@cursor-team");
    expect(detail.supportedCapabilities).toEqual(["skills"]);
    expect(detail.unsupportedCapabilities).toContain("rules");
    const installed = await installMarketplacePlugin(detail.id, { enabled: false });
    expect(installed.enabled).toBe(false);
    await enablePlugin(installed.id);
    expect(loadConfig().plugins![installed.id].enabled).toBe(true);
    await disablePlugin(installed.id);
    expect(loadConfig().plugins![installed.id].enabled).toBe(false);
    await enablePlugin(installed.id);
    await expect(installMarketplacePlugin(detail.id)).rejects.toThrow("already installed");
    await pinPlugin(installed.id);
    writeJson(manifest, { name: "reviewer", version: "2", skills: "./skills" });
    writeText(skill, "---\nname: review\ndescription: Review code\n---\nVersion two");
    expect((await refreshMarketplaceWithPlugins(marketplace.name)).updated).toEqual([]);
    expect(loadConfig().plugins![installed.id].version).toBe("1");
    await unpinPlugin(installed.id);
    const updated = await updateMarketplaceInstalledPlugin(installed.id);
    expect(updated.version).toBe("2");
    writeJson(manifest, { name: "reviewer", version: "3", skills: "./skills" });
    writeText(skill, "---\nname: review\ndescription: Review code\n---\nVersion three");
    await refreshMarketplaceWithPlugins(marketplace.name);
    expect(loadConfig().plugins![installed.id].version).toBe("3");
    const rolledBack = await rollbackPlugin(installed.id);
    expect(rolledBack.version).toBe("2");
    expect(fs.readFileSync(path.join(rolledBack.root, "skills/review/SKILL.md"), "utf8")).toContain("Version two");
    expect((await updateMarketplaceInstalledPlugin(installed.id)).version).toBe("3");
    await uninstallPlugin(installed.id, true);
    expect(loadConfig().plugins![installed.id]).toBeUndefined();
    await removeMarketplace(marketplace.name);
    expect(loadConfig().marketplaces![marketplace.name]).toBeUndefined();
  } finally { env.restore(); }
});

it("rejects manifest and plugin paths escaping the catalog snapshot", async () => {
  const env = setupTempEnv("catalog-containment-");
  process.env.MCPX_NO_UPDATE = "1";
  try {
    const root = path.join(env.root, "catalog"); fs.mkdirSync(root);
    writeJson(path.join(env.root, "outside.json"), { name: "outside", plugins: [] });
    fs.symlinkSync(path.join(env.root, "outside.json"), path.join(root, "marketplace.json"));
    await expect(addMarketplace(root)).rejects.toThrow("escapes");
  } finally { env.restore(); }
});

it("supports a custom manifest filename and hashes plugin changes independently of catalog metadata", async () => {
  const env = setupTempEnv("custom-catalog-file-");
  process.env.MCPX_NO_UPDATE = "1";
  try {
    const root = path.join(env.root, "catalog");
    const catalog = path.join(root, "team.json");
    writeJson(catalog, { name: "file-team", plugins: [{ name: "reviewer", source: "./reviewer" }] });
    writeJson(path.join(root, "reviewer/plugin.json"), { name: "reviewer", version: "1" });
    writeText(path.join(root, "reviewer/skills/review/SKILL.md"), "---\nname: review\ndescription: Review\n---\nOne");
    const before = await addMarketplace(catalog);
    const installed = await installMarketplacePlugin("reviewer@file-team");
    writeText(path.join(root, "reviewer/skills/review/SKILL.md"), "---\nname: review\ndescription: Review\n---\nTwo");
    const after = await refreshMarketplaceWithPlugins(before.name);
    expect(after.marketplace.resolvedRevision).not.toBe(before.resolvedRevision);
    expect(after.updated).toEqual([installed.id]);
    expect(fs.readFileSync(path.join(loadConfig().plugins![installed.id].root, "skills/review/SKILL.md"), "utf8")).toContain("Two");
  } finally { env.restore(); }
});

it("supports marketplace installation and removal through the real CLI, including aliases and disabled installs", async () => {
  const env = setupTempEnv("marketplace-cli-");
  process.env.MCPX_NO_UPDATE = "1";
  try {
    const root = path.join(env.root, "catalog");
    writeJson(path.join(root, "marketplace.json"), { name: "cli-team", plugins: [{ name: "reviewer", source: "./reviewer" }] });
    writeJson(path.join(root, "reviewer/plugin.json"), { name: "reviewer", version: "1" });
    writeText(path.join(root, "reviewer/skills/review/SKILL.md"), "---\nname: review\ndescription: Review\n---\nBody");
    const run = async (args: string[]) => {
      const process = Bun.spawn(["node", path.join(import.meta.dir, "../dist/cli.js"), ...args], { env: { ...globalThis.process.env, MCPX_TELEMETRY_DISABLED: "1" }, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
      expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
      return stdout;
    };
    expect(await run(["plugin", "marketplace", "add", root])).toContain("cli-team");
    expect(await run(["plugin", "browse", "--marketplace", "cli-team"])).toContain("reviewer@cli-team");
    await run(["plugin", "install", "reviewer@cli-team", "--yes", "--no-enable", "--name", "my-reviewer"]);
    const installed = Object.values(loadConfig().plugins!)[0];
    expect(installed.name).toBe("my-reviewer");
    expect(installed.enabled).toBe(false);
    await run(["plugin", "enable", "my-reviewer"]);
    expect(loadConfig().plugins![installed.id].enabled).toBe(true);
    await run(["plugin", "uninstall", "my-reviewer", "--keep-data"]);
    expect(loadConfig().plugins![installed.id]).toBeUndefined();
    await run(["plugin", "marketplace", "remove", "cli-team", "--yes"]);
    expect(loadConfig().marketplaces!["cli-team"]).toBeUndefined();
  } finally { env.restore(); }
}, 20_000);

it("runs an installed plugin MCP server through the managed host", async () => {
  const env = setupTempEnv("marketplace-mcp-host-");
  process.env.MCPX_NO_UPDATE = "1";
  try {
    const root = path.join(env.root, "catalog");
    writeJson(path.join(root, "marketplace.json"), { name: "mcp-team", plugins: [{ name: "echo", source: "./echo" }] });
    writeJson(path.join(root, "echo/plugin.json"), { name: "echo", version: "1", mcpServers: "./mcp.json" });
    writeJson(path.join(root, "echo/mcp.json"), { mcpServers: { service: { command: "node", args: ["${MCPX_PLUGIN_ROOT}/server.cjs"] } } });
    writeText(path.join(root, "echo/server.cjs"), `
      require("node:readline").createInterface({ input: process.stdin }).on("line", line => {
        const request = JSON.parse(line);
        const result = request.method === "server/discover"
          ? { supportedVersions: ["2026-07-28"], capabilities: { tools: {} } }
          : { tools: [{ name: "echo", inputSchema: { type: "object" } }] };
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { resultType: "complete", ttlMs: 0, cacheScope: "private", ...result } }) + "\\n");
      });
    `);
    await addMarketplace(root);
    const installed = await installMarketplacePlugin("echo@mcp-team");
    const { verifyUpstreams } = await import("../src/core/verify-upstreams.js");
    await verifyUpstreams(loadConfig(), installed.serverNames);
    await uninstallPlugin(installed.id);
    expect(loadConfig().servers.echo__service).toBeUndefined();
  } finally { env.restore(); }
}, 20_000);
