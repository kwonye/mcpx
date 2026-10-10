import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { defaultConfig, saveConfig } from "../src/core/config.js";
import { SecretsManager } from "../src/core/secrets.js";
import { syncAllClients } from "../src/core/sync.js";
import { setupTempEnv } from "./helpers.js";

describe("project-scoped plugin projections", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  it("projects Pi skills into the opted-in project and honors project component overrides", () => {
    const env = setupTempEnv("mcpx-project-plugin-");
    cleanups.push(env.restore);

    const projectPath = path.join(env.root, "project");
    const pluginRoot = path.join(env.root, "plugin");
    const skillPath = path.join(pluginRoot, "skills", "start", "SKILL.md");
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, "---\nname: start\ndescription: Project plugin skill\n---\n# Start\n");

    const config = defaultConfig();
    const projectAdapterId = `pi@${projectPath}`;
    config.projects![projectPath] = { name: "project", path: projectPath, disabledServers: [] };
    config.harnesses = { [projectAdapterId]: { mode: "selected" } };
    config.plugins!["example/guide"] = {
      id: "example/guide",
      name: "Guide",
      source: "example/guide",
      version: "1.0.0",
      ref: "main",
      resolvedSha: "abc123",
      installedAt: new Date().toISOString(),
      root: pluginRoot,
      dataDir: pluginRoot,
      components: { mcpServers: false, skills: true, hooks: false, agents: false, commands: false },
      discovered: {
        skills: [{ id: "start", type: "skills", path: skillPath }],
        commands: [],
        agents: [],
        hooks: [],
        mcpServers: [],
      },
      enabled: true,
      status: "healthy",
      serverNames: [],
      projectedClients: [],
    };

    const projectSkills = path.join(projectPath, ".pi", "skills");
    const projectSkill = path.join(projectSkills, "Guide__start", "SKILL.md");
    const globalSkill = path.join(env.root, ".pi", "agent", "skills", "Guide__start", "SKILL.md");
    const localProjectFile = path.join(projectSkills, "local", "SKILL.md");
    fs.mkdirSync(path.dirname(localProjectFile), { recursive: true });
    fs.writeFileSync(localProjectFile, "local project skill");
    saveConfig(config);

    const first = syncAllClients(config, new SecretsManager());
    expect(fs.existsSync(projectSkill)).toBe(true);
    expect(fs.existsSync(globalSkill)).toBe(true);
    expect(first.pluginResults?.some(result => result.clientId === projectAdapterId && result.projectedDirs.includes(path.dirname(projectSkill)))).toBe(true);

    config.plugins!["example/guide"].projectOverrides = { [projectPath]: { components: { skills: false } } };
    const second = syncAllClients(config, new SecretsManager());

    expect(fs.existsSync(projectSkill)).toBe(false);
    expect(fs.readFileSync(localProjectFile, "utf8")).toBe("local project skill");
    expect(fs.existsSync(globalSkill)).toBe(true);
    expect(second.pluginResults?.some(result => result.clientId === projectAdapterId)).toBe(true);

    delete config.plugins!["example/guide"].projectOverrides;
    syncAllClients(config, new SecretsManager());
    expect(fs.existsSync(projectSkill)).toBe(true);

    config.plugins!["example/guide"].projectOverrides = { [projectPath]: { enabled: false } };
    syncAllClients(config, new SecretsManager());
    expect(fs.existsSync(projectSkill)).toBe(false);
    expect(fs.existsSync(globalSkill)).toBe(true);
  });
});
