import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { setupTempEnv } from "./helpers.js";
import { getAdapter } from "../src/adapters/index.js";
import { listHarnesses } from "../src/core/harnesses.js";
import { defaultConfig } from "../src/core/config.js";
import type { Skill } from "../src/types.js";

describe("adapter syncSkills methods", () => {
  it("every catalogued adapter implements syncSkills", () => {
    for (const id of ["claude-desktop", "opencode"] as const) {
      expect(typeof getAdapter(id)?.syncSkills).toBe("function");
    }
  });

  it("uses Codex's shared skill directory and retains legacy discovery", () => {
    const env = setupTempEnv("codex-skill-locations-");
    try {
      const adapter = getAdapter("codex")!;
      adapter.syncSkills!([{ id: "review", content: "---\nname: review\ndescription: Test workflow\n---\n# Review" }]);
      expect(fs.readFileSync(path.join(env.root, ".agents/skills/review/SKILL.md"), "utf8")).toBe("---\nname: review\ndescription: Test workflow\n---\n# Review");
      expect(adapter.additionalSkillDirectories!()).toContain(path.join(env.root, ".codex/skills"));
      const config = defaultConfig();
      const project = path.join(env.root, "project");
      config.projects = { project: { name: "Project", path: project } };
      const installations = listHarnesses(config);
      expect(installations.find(h => h.harness === "codex" && h.scope === "project")?.skillPaths).toEqual([path.join(project, ".agents/skills")]);
      expect(installations.find(h => h.harness === "vscode" && h.scope === "project")?.skillPaths).toEqual([path.join(project, ".github/skills")]);
    } finally { env.restore(); }
  });

  it("Claude Desktop projects skills to a skills dir next to its config", () => {
    const env = setupTempEnv("claude-desktop-skills-");
    try {
      const adapter = getAdapter("claude-desktop", { platform: "darwin" })!;
      const content = "---\nname: test-skill\ndescription: Test workflow\n---\n# Test Skill\nContent here";
      adapter.syncSkills!([{ id: "test-skill", content }]);

      const skillFile = path.join(path.dirname(adapter.detectConfigPath()!), "skills", "test-skill", "SKILL.md");
      expect(skillFile).toBe(path.join(env.root, "Library", "Application Support", "Claude", "skills", "test-skill", "SKILL.md"));
      expect(fs.readFileSync(skillFile, "utf8")).toBe(content);
    } finally {
      env.restore();
    }
  });

  it("OpenCode projects multiple skills with dir layout next to its config", () => {
    const env = setupTempEnv("opencode-multi-skills-");
    try {
      const adapter = getAdapter("opencode", { platform: "darwin" })!;
      const skills: Skill[] = [
        { id: "skill-one", content: "---\nname: skill-one\ndescription: Test workflow\n---\n# Skill One" },
        { id: "skill-two", content: "---\nname: skill-two\ndescription: Test workflow\n---\n# Skill Two" },
      ];
      adapter.syncSkills!(skills);

      const skillsDir = path.join(env.root, ".config", "opencode", "skills");
      expect(path.dirname(adapter.detectConfigPath()!)).toBe(path.dirname(skillsDir));
      expect(fs.readFileSync(path.join(skillsDir, "skill-one", "SKILL.md"), "utf8")).toBe(skills[0].content);
      expect(fs.readFileSync(path.join(skillsDir, "skill-two", "SKILL.md"), "utf8")).toBe(skills[1].content);
    } finally {
      env.restore();
    }
  });
});
