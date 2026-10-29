import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { setupTempEnv } from "./helpers.js";
import { ClaudeDesktopAdapter } from "../src/adapters/claude-desktop.js";
import { OpenCodeAdapter } from "../src/adapters/json.js";
import { CodexAdapter } from "../src/adapters/codex.js";
import { listHarnesses } from "../src/core/harnesses.js";
import { defaultConfig } from "../src/core/config.js";
import type { Skill } from "../src/types.js";

describe("adapter syncSkills methods", () => {
  it("uses Codex's shared skill directory and retains legacy discovery", () => {
    const env = setupTempEnv("codex-skill-locations-");
    try {
      const adapter = new CodexAdapter();
      adapter.syncSkills([{ id: "review", content: "---\nname: review\ndescription: Test workflow\n---\n# Review" }]);
      expect(fs.readFileSync(path.join(env.root, ".agents/skills/review/SKILL.md"), "utf8")).toBe("---\nname: review\ndescription: Test workflow\n---\n# Review");
      expect(adapter.additionalSkillDirectories()).toContain(path.join(env.root, ".codex/skills"));
      const config = defaultConfig();
      const project = path.join(env.root, "project");
      config.projects = { project: { name: "Project", path: project } };
      const installations = listHarnesses(config);
      expect(installations.find(h => h.harness === "codex" && h.scope === "project")?.skillPaths).toEqual([path.join(project, ".agents/skills")]);
      expect(installations.find(h => h.harness === "vscode" && h.scope === "project")?.skillPaths).toEqual([path.join(project, ".github/skills")]);
    } finally { env.restore(); }
  });
  it("ClaudeDesktopAdapter implements syncSkills", () => {
    const adapter = new ClaudeDesktopAdapter();
    expect(typeof adapter.syncSkills).toBe("function");
  });

  it("OpenCodeAdapter implements syncSkills", () => {
    const adapter = new OpenCodeAdapter();
    expect(typeof adapter.syncSkills).toBe("function");
  });

  it("ClaudeDesktopAdapter.syncSkills projects skills to sibling skills dir", () => {
    const env = setupTempEnv("claude-desktop-skills-");
    const adapter = new ClaudeDesktopAdapter();

    const skills: Skill[] = [
      { id: "test-skill", content: "---\nname: test-skill\ndescription: Test workflow\n---\n# Test Skill\nContent here" },
    ];

    adapter.syncSkills(skills);

    // Claude Desktop config path on macOS would be in ~/Library/Application Support/Claude/
    // So skills dir would be ~/Library/Application Support/Claude/skills
    const configPath = adapter.detectConfigPath();
    expect(configPath).not.toBeNull();
    if (configPath) {
      const skillsDir = path.join(path.dirname(configPath), "skills");
      const skillFile = path.join(skillsDir, "test-skill", "SKILL.md");
      expect(fs.existsSync(skillFile)).toBe(true);
      expect(fs.readFileSync(skillFile, "utf8")).toBe("---\nname: test-skill\ndescription: Test workflow\n---\n# Test Skill\nContent here");
    }

    env.restore();
  });

  it("ClaudeDesktopAdapter.syncSkills handles null detectConfigPath gracefully", () => {
    const env = setupTempEnv("claude-desktop-null-");
    const adapter = new ClaudeDesktopAdapter();

    // Temporarily override detectConfigPath to return null
    const originalDetectConfigPath = adapter.detectConfigPath.bind(adapter);
    adapter.detectConfigPath = () => null;

    const skills: Skill[] = [
      { id: "test-skill", content: "---\nname: test-skill\ndescription: Test workflow\n---\n# Test Skill" },
    ];

    // Should not throw
    expect(() => adapter.syncSkills(skills)).not.toThrow();

    // Restore original
    adapter.detectConfigPath = originalDetectConfigPath;
    env.restore();
  });

  it("OpenCodeAdapter.syncSkills projects skills to sibling skills dir", () => {
    const env = setupTempEnv("opencode-skills-");
    const adapter = new OpenCodeAdapter();

    const skills: Skill[] = [
      { id: "my-skill", content: "---\nname: my-skill\ndescription: Test workflow\n---\n# My Skill\nTest content" },
    ];

    adapter.syncSkills(skills);

    // OpenCode config path is ~/.config/opencode/opencode.json
    // So skills dir would be ~/.config/opencode/skills
    const configPath = adapter.detectConfigPath();
    expect(configPath).not.toBeNull();
    if (configPath) {
      const skillsDir = path.join(path.dirname(configPath), "skills");
      const skillFile = path.join(skillsDir, "my-skill", "SKILL.md");
      expect(fs.existsSync(skillFile)).toBe(true);
      expect(fs.readFileSync(skillFile, "utf8")).toBe("---\nname: my-skill\ndescription: Test workflow\n---\n# My Skill\nTest content");
    }

    env.restore();
  });

  it("OpenCodeAdapter.syncSkills handles null detectConfigPath gracefully", () => {
    const env = setupTempEnv("opencode-null-");
    const adapter = new OpenCodeAdapter();

    // Temporarily override detectConfigPath to return null
    const originalDetectConfigPath = adapter.detectConfigPath.bind(adapter);
    adapter.detectConfigPath = () => null;

    const skills: Skill[] = [
      { id: "test-skill", content: "---\nname: test-skill\ndescription: Test workflow\n---\n# Test" },
    ];

    // Should not throw
    expect(() => adapter.syncSkills(skills)).not.toThrow();

    // Restore original
    adapter.detectConfigPath = originalDetectConfigPath;
    env.restore();
  });

  it("OpenCodeAdapter.syncSkills syncs multiple skills with dir layout", () => {
    const env = setupTempEnv("opencode-multi-skills-");
    const adapter = new OpenCodeAdapter();

    const skills: Skill[] = [
      { id: "skill-one", content: "---\nname: skill-one\ndescription: Test workflow\n---\n# Skill One" },
      { id: "skill-two", content: "---\nname: skill-two\ndescription: Test workflow\n---\n# Skill Two" },
    ];

    adapter.syncSkills(skills);

    const configPath = adapter.detectConfigPath();
    expect(configPath).not.toBeNull();
    if (configPath) {
      const skillsDir = path.join(path.dirname(configPath), "skills");
      expect(fs.existsSync(path.join(skillsDir, "skill-one", "SKILL.md"))).toBe(true);
      expect(fs.existsSync(path.join(skillsDir, "skill-two", "SKILL.md"))).toBe(true);
      expect(fs.readFileSync(path.join(skillsDir, "skill-one", "SKILL.md"), "utf8")).toBe("---\nname: skill-one\ndescription: Test workflow\n---\n# Skill One");
      expect(fs.readFileSync(path.join(skillsDir, "skill-two", "SKILL.md"), "utf8")).toBe("---\nname: skill-two\ndescription: Test workflow\n---\n# Skill Two");
    }

    env.restore();
  });
});
