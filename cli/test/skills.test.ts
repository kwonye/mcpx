import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { listSkills, getSkill, saveSkill, deleteSkill } from "../src/core/skills.js";

function setupTempEnv(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const oldHome = process.env.HOME;
  const oldConfigHome = process.env.MCPX_CONFIG_HOME;
  
  process.env.HOME = root;
  process.env.MCPX_CONFIG_HOME = path.join(root, ".config");

  return {
    root,
    restore: () => {
      process.env.HOME = oldHome;
      process.env.MCPX_CONFIG_HOME = oldConfigHome;
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

describe("skills core", () => {
  let env: ReturnType<typeof setupTempEnv>;

  beforeEach(() => {
    env = setupTempEnv("mcpx-skills-test-");
  });

  afterEach(() => {
    env.restore();
  });

  it("lists, gets, saves, and deletes skills", () => {
    const skills = listSkills();
    expect(skills).toEqual([]);

    saveSkill("test-skill", "# Test Skill\nContent");
    const skillsAfterSave = listSkills();
    expect(skillsAfterSave.length).toBe(1);
    expect(skillsAfterSave[0].id).toBe("test-skill");
    expect(skillsAfterSave[0].content).toBe("# Test Skill\nContent");

    const skill = getSkill("test-skill");
    expect(skill).not.toBeNull();
    expect(skill?.content).toBe("# Test Skill\nContent");

    deleteSkill("test-skill");
    expect(listSkills()).toEqual([]);
    expect(getSkill("test-skill")).toBeNull();
  });
});
