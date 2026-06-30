import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PluginCache } from "../src/core/plugin-cache.js";
import { PluginDataManager } from "../src/core/plugin-data.js";
import { PluginLifecycle } from "../src/core/plugin-lifecycle.js";
import { PluginManager } from "../src/core/plugin-manager.js";
import { parseSource } from "../src/core/plugin-source.js";
import { readManifest, discoverComponents, hasManifest } from "../src/core/plugin-parse.js";
import { syncPluginsToClient, prunePluginProjections, pruneAllPluginProjections } from "../src/core/plugin-projections.js";

function setupTempEnv(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const oldHome = process.env.HOME;
  const oldConfigHome = process.env.MCPX_CONFIG_HOME;
  const oldDataHome = process.env.MCPX_DATA_HOME;
  const oldStateHome = process.env.MCPX_STATE_HOME;
  
  process.env.HOME = root;
  process.env.MCPX_CONFIG_HOME = path.join(root, ".config");
  process.env.MCPX_DATA_HOME = path.join(root, ".local", "share");
  process.env.MCPX_STATE_HOME = path.join(root, ".local", "state");

  return {
    root,
    restore: () => {
      process.env.HOME = oldHome;
      process.env.MCPX_CONFIG_HOME = oldConfigHome;
      process.env.MCPX_DATA_HOME = oldDataHome;
      process.env.MCPX_STATE_HOME = oldStateHome;
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

describe("plugin source parsing", () => {
  it("parses github sources", () => {
    const s1 = parseSource("obra/superpowers");
    expect(s1.type).toBe("github");
    expect(s1.ref).toBeUndefined();

    const s2 = parseSource("obra/superpowers@main");
    expect(s2.type).toBe("github");
    expect(s2.ref).toBe("main");

    const s3 = parseSource("github.com/obra/superpowers@v1.0");
    expect(s3.type).toBe("github");
    expect(s3.ref).toBe("v1.0");
  });

  it("parses local paths", () => {
    const s1 = parseSource("/Users/test/plugin");
    expect(s1.type).toBe("local");

    const s2 = parseSource("./my-plugin");
    expect(s2.type).toBe("local");

    const s3 = parseSource("../other");
    expect(s3.type).toBe("local");
  });

  it("parses npm sources", () => {
    const s = parseSource("npm:@scope/pkg@1.0.0");
    expect(s.type).toBe("npm");
    expect(s.ref).toBe("1.0.0");
  });
});

describe("plugin manifest parsing", () => {
  let env: ReturnType<typeof setupTempEnv>;

  beforeEach(() => {
    env = setupTempEnv("mcpx-parse-test-");
  });

  afterEach(() => {
    env.restore();
  });

  it("reads manifest from .claude-plugin/plugin.json", () => {
    const pluginRoot = path.join(env.root, "test-plugin");
    fs.mkdirSync(path.join(pluginRoot, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "test-plugin", version: "1.0.0", description: "A test" })
    );

    const manifest = readManifest(pluginRoot);
    expect(manifest).not.toBeNull();
    expect(manifest?.name).toBe("test-plugin");
    expect(manifest?.version).toBe("1.0.0");
    expect(manifest?.description).toBe("A test");
  });

  it("returns null for missing manifest", () => {
    expect(readManifest(env.root)).toBeNull();
  });

  it("discovers skills from skills/*/SKILL.md", () => {
    const pluginRoot = path.join(env.root, "test-plugin");
    fs.mkdirSync(path.join(pluginRoot, "skills", "my-skill"), { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, "skills", "my-skill", "SKILL.md"),
      "---\nname: My Skill\ndescription: A skill\n---\n# Content"
    );

    const components = discoverComponents(pluginRoot);
    expect(components.skills).toHaveLength(1);
    expect(components.skills[0].id).toBe("My Skill");
    expect(components.skills[0].type).toBe("skills");
  });

  it("discovers mcp servers from .mcp.json", () => {
    const pluginRoot = path.join(env.root, "test-plugin");
    fs.mkdirSync(pluginRoot, { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          "my-server": { command: "node", args: ["server.js"] }
        }
      })
    );

    const components = discoverComponents(pluginRoot);
    expect(components.mcpServers).toHaveLength(1);
    expect(components.mcpServers[0].id).toBe("my-server");
    expect(components.mcpServers[0].command).toBe("node");
  });

  it("discovers hooks from hooks/hooks.json", () => {
    const pluginRoot = path.join(env.root, "test-plugin");
    fs.mkdirSync(path.join(pluginRoot, "hooks"), { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, "hooks", "hooks.json"),
      JSON.stringify({ hooks: [{ id: "pre-tool", description: "Runs before tool calls" }] })
    );

    const components = discoverComponents(pluginRoot);
    expect(components.hooks).toHaveLength(1);
    expect(components.hooks[0].id).toBe("pre-tool");
  });

  it("discovers commands from commands/*.md", () => {
    const pluginRoot = path.join(env.root, "test-plugin");
    fs.mkdirSync(path.join(pluginRoot, "commands"), { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, "commands", "test-cmd.md"),
      "---\nname: Test Command\ndescription: A command\n---\n# Content"
    );

    const components = discoverComponents(pluginRoot);
    expect(components.commands).toHaveLength(1);
    expect(components.commands[0].id).toBe("Test Command");
  });
});

describe("plugin cache", () => {
  let env: ReturnType<typeof setupTempEnv>;

  beforeEach(() => {
    env = setupTempEnv("mcpx-plugin-cache-test-");
  });

  afterEach(() => {
    env.restore();
  });

  it("caches and retrieves local plugins", async () => {
    // Create a local plugin directory
    const pluginRoot = path.join(env.root, "src-plugin");
    fs.mkdirSync(path.join(pluginRoot, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "test-plugin", version: "1.0.0" })
    );
    fs.writeFileSync(path.join(pluginRoot, "test.md"), "# Test");

    const cache = new PluginCache();
    const source = parseSource(pluginRoot);
    const sha = await cache.resolveSha(source);
    source.resolvedSha = sha;
    const cached = await cache.fetch(source, "test-plugin");

    expect(cached.root).toBeTruthy();
    expect(fs.existsSync(cached.root)).toBe(true);

    // Verify cache hit is idempotent
    const cached2 = await cache.fetch(source, "test-plugin");
    expect(cached2.root).toBe(cached.root);
  });

  it("lists cached plugins", async () => {
    const cache = new PluginCache();
    const plugins = cache.listCached();
    expect(Array.isArray(plugins)).toBe(true);
  });
});

describe("plugin projections", () => {
  let env: ReturnType<typeof setupTempEnv>;

  beforeEach(() => {
    env = setupTempEnv("mcpx-plugin-projections-test-");
  });

  afterEach(() => {
    env.restore();
  });

  it("syncs plugins to Claude Code via @skills-dir", () => {
    // Create a plugin root with manifest and skills
    const pluginRoot = path.join(env.root, "test-plugin");
    fs.mkdirSync(path.join(pluginRoot, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "test-plugin", version: "1.0.0" })
    );
    fs.mkdirSync(path.join(pluginRoot, "skills", "my-skill"), { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, "skills", "my-skill", "SKILL.md"),
      "# My Skill\n\nContent"
    );
    fs.writeFileSync(
      path.join(pluginRoot, ".mcp.json"),
      JSON.stringify({ mcpServers: { "srv": { command: "node" } } })
    );

    const result = syncPluginsToClient("claude", [{
      pluginId: "test-plugin@abc123",
      pluginName: "test-plugin",
      pluginRoot,
      components: { mcpServers: true, skills: true, hooks: false, agents: false, commands: false },
      approvals: { mcpServers: false },
      enabled: true,
      serverNames: ["test-plugin__srv"],
      skills: [{ id: "my-skill", type: "skills", path: path.join(pluginRoot, "skills", "my-skill", "SKILL.md") }],
      commands: [],
      agents: [],
      hooks: [],
    }]);

    expect(result.status).toBe("SYNCED");
    expect(result.projectedDirs.length).toBeGreaterThan(0);

    // Verify Claude skills dir was created
    const claudeSkillsDir = path.join(env.root, ".claude", "skills", "test-plugin");
    expect(fs.existsSync(claudeSkillsDir)).toBe(true);

    // .mcp.json should NOT be in the Claude projection (stripped)
    expect(fs.existsSync(path.join(claudeSkillsDir, ".mcp.json"))).toBe(false);

    // Ownership manifest should exist
    expect(fs.existsSync(path.join(env.root, ".claude", "skills", "mcpx-plugins.json"))).toBe(true);
  });

  it("reports unsupported components per client", () => {
    const result = syncPluginsToClient("claude-desktop", []);
    expect(result.unsupported).toContain("skills");

    const codexResult = syncPluginsToClient("codex", []);
    expect(codexResult.unsupported).toContain("hooks");

    const kiroResult = syncPluginsToClient("kiro", []);
    expect(kiroResult.unsupported).toContain("commands");
  });
});

describe("plugin data manager", () => {
  let env: ReturnType<typeof setupTempEnv>;

  beforeEach(() => {
    env = setupTempEnv("mcpx-plugin-data-test-");
  });

  afterEach(() => {
    env.restore();
  });

  it("saves and loads plugin data", async () => {
    const dataManager = new PluginDataManager();
    const pluginId = "test-plugin";

    await dataManager.saveData(pluginId, {
      id: pluginId,
      dependencies: { "node": "^18.0.0" },
      settings: { "enabled": true },
      logs: [],
      status: "healthy",
      installedAt: new Date().toISOString()
    });

    const data = await dataManager.loadData(pluginId);
    expect(data).not.toBeNull();
    expect(data?.id).toBe(pluginId);
    expect(data?.dependencies?.node).toBe("^18.0.0");
  });
});

describe("plugin manager basic", () => {
  let env: ReturnType<typeof setupTempEnv>;

  beforeEach(() => {
    env = setupTempEnv("mcpx-plugin-manager-test-");
  });

  afterEach(() => {
    env.restore();
  });

  it("lists plugins (empty)", async () => {
    const manager = new PluginManager();
    const plugins = await manager.listPlugins();
    expect(plugins).toEqual([]);
  });

  it("gets plugin status (not found)", async () => {
    const manager = new PluginManager();
    const plugin = await manager.getPluginStatus("non-existent-plugin");
    expect(plugin).toBeNull();
  });
});
