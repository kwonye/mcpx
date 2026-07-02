import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { setupTempEnv } from "./helpers.js";
import { projectSkillsToDir } from "../src/core/skill-projections.js";

describe("projectSkillsToDir", () => {
  it("projects skills in flat layout", () => {
    const env = setupTempEnv("skill-flat-");
    const targetDir = path.join(env.root, "skills");

    projectSkillsToDir(targetDir, [
      { id: "my-skill", content: "# My Skill\ncontent here" },
      { id: "other", content: "# Other\nmore content" },
    ], "flat");

    expect(fs.readFileSync(path.join(targetDir, "my-skill.md"), "utf8")).toBe("# My Skill\ncontent here");
    expect(fs.readFileSync(path.join(targetDir, "other.md"), "utf8")).toBe("# Other\nmore content");
    expect(fs.existsSync(path.join(targetDir, "mcpx-skills.json"))).toBe(true);

    env.restore();
  });

  it("projects skills in dir layout", () => {
    const env = setupTempEnv("skill-dir-");
    const targetDir = path.join(env.root, "skills");

    projectSkillsToDir(targetDir, [
      { id: "my-skill", content: "# My Skill\ncontent" },
    ], "dir");

    expect(fs.readFileSync(path.join(targetDir, "my-skill", "SKILL.md"), "utf8")).toBe("# My Skill\ncontent");

    env.restore();
  });

  it("updates content on re-sync", () => {
    const env = setupTempEnv("skill-update-");
    const targetDir = path.join(env.root, "skills");

    projectSkillsToDir(targetDir, [
      { id: "my-skill", content: "# Version 1" },
    ], "flat");

    projectSkillsToDir(targetDir, [
      { id: "my-skill", content: "# Version 2" },
    ], "flat");

    expect(fs.readFileSync(path.join(targetDir, "my-skill.md"), "utf8")).toBe("# Version 2");

    env.restore();
  });

  it("prunes a removed skill", () => {
    const env = setupTempEnv("skill-prune-");
    const targetDir = path.join(env.root, "skills");

    projectSkillsToDir(targetDir, [
      { id: "keep", content: "# Keep" },
      { id: "remove", content: "# Remove" },
    ], "flat");

    expect(fs.existsSync(path.join(targetDir, "keep.md"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "remove.md"))).toBe(true);

    projectSkillsToDir(targetDir, [
      { id: "keep", content: "# Keep" },
    ], "flat");

    expect(fs.existsSync(path.join(targetDir, "keep.md"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "remove.md"))).toBe(false);

    env.restore();
  });

  it("pre-existing user file survives sync (data-loss guard)", () => {
    const env = setupTempEnv("skill-userfile-");
    const targetDir = path.join(env.root, "skills");
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, "user-file.md"), "# User authored", "utf8");

    projectSkillsToDir(targetDir, [
      { id: "mcpx-skill", content: "# From mcpx" },
    ], "flat");

    expect(fs.readFileSync(path.join(targetDir, "user-file.md"), "utf8")).toBe("# User authored");
    expect(fs.readFileSync(path.join(targetDir, "mcpx-skill.md"), "utf8")).toBe("# From mcpx");

    const manifest = JSON.parse(
      fs.readFileSync(path.join(targetDir, "mcpx-skills.json"), "utf8")
    );
    expect(manifest.paths).not.toContain("user-file.md");

    env.restore();
  });
});
