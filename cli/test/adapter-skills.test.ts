import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { setupTempEnv } from "./helpers.js";
import { getAdapter } from "../src/adapters/index.js";
import type { Skill } from "../src/types.js";

describe("adapter syncSkills methods", () => {
  it("every catalogued adapter implements syncSkills", () => {
    for (const id of ["claude-desktop", "opencode"] as const) {
      expect(typeof getAdapter(id)?.syncSkills).toBe("function");
    }
  });

  it("Claude Desktop projects skills to a skills dir next to its config", () => {
    const env = setupTempEnv("claude-desktop-skills-");
    try {
      const adapter = getAdapter("claude-desktop", { platform: "darwin" })!;
      adapter.syncSkills!([{ id: "test-skill", content: "# Test Skill\nContent here" }]);

      const skillFile = path.join(path.dirname(adapter.detectConfigPath()!), "skills", "test-skill", "SKILL.md");
      expect(skillFile).toBe(path.join(env.root, "Library", "Application Support", "Claude", "skills", "test-skill", "SKILL.md"));
      expect(fs.readFileSync(skillFile, "utf8")).toBe("# Test Skill\nContent here");
    } finally {
      env.restore();
    }
  });

  it("OpenCode projects multiple skills with dir layout next to its config", () => {
    const env = setupTempEnv("opencode-multi-skills-");
    try {
      const adapter = getAdapter("opencode", { platform: "darwin" })!;
      const skills: Skill[] = [
        { id: "skill-one", content: "# Skill One" },
        { id: "skill-two", content: "# Skill Two" },
      ];
      adapter.syncSkills!(skills);

      const skillsDir = path.join(env.root, ".config", "opencode", "skills");
      expect(path.dirname(adapter.detectConfigPath()!)).toBe(path.dirname(skillsDir));
      expect(fs.readFileSync(path.join(skillsDir, "skill-one", "SKILL.md"), "utf8")).toBe("# Skill One");
      expect(fs.readFileSync(path.join(skillsDir, "skill-two", "SKILL.md"), "utf8")).toBe("# Skill Two");
    } finally {
      env.restore();
    }
  });
});
