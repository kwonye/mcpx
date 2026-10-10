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

  it("links complete authored skill directories and preserves supporting files", () => {
    const env = setupTempEnv("skill-link-");
    const source = path.join(env.root, "source-skill");
    const targetDir = path.join(env.root, "client", "skills");
    fs.mkdirSync(path.join(source, "references"), { recursive: true });
    fs.writeFileSync(path.join(source, "SKILL.md"), "# Linked");
    fs.writeFileSync(path.join(source, "references", "guide.md"), "Guide");

    projectSkillsToDir(targetDir, [{ id: "linked", content: "# Linked", root: source, source: "authored" }], "dir");

    const projection = path.join(targetDir, "linked");
    expect(fs.lstatSync(projection).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(projection, "references", "guide.md"), "utf8")).toBe("Guide");
    env.restore();
  });
});

describe("projection ownership safety", () => {
  it("migrates unchanged legacy ownership and can update and prune it", () => {
    const env = setupTempEnv("skill-legacy-");
    try {
      const dir = path.join(env.root, "skills");
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, "same.md"), "managed");
      fs.writeFileSync(path.join(dir, "mcpx-skills.json"), JSON.stringify({ version: 1, paths: ["same.md"] }));
      projectSkillsToDir(dir, [{ id: "same", content: "managed" }], "flat");
      projectSkillsToDir(dir, [{ id: "same", content: "updated" }], "flat");
      expect(fs.readFileSync(path.join(dir, "same.md"), "utf8")).toBe("updated");
      projectSkillsToDir(dir, [], "flat");
      expect(fs.existsSync(path.join(dir, "same.md"))).toBe(false);
    } finally { env.restore(); }
  });
  it("retains ambiguous legacy paths for review without overwriting or forgetting them", () => {
    const env = setupTempEnv("skill-legacy-edited-");
    try {
      const dir = path.join(env.root, "skills");
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, "same.md"), "user edit");
      fs.writeFileSync(path.join(dir, "mcpx-skills.json"), JSON.stringify({ version: 1, paths: ["same.md"] }));
      expect(() => projectSkillsToDir(dir, [{ id: "same", content: "managed" }], "flat")).toThrow();
      expect(() => projectSkillsToDir(dir, [], "flat")).toThrow();
      expect(JSON.parse(fs.readFileSync(path.join(dir, "mcpx-skills.json"), "utf8")).paths).toContain("same.md");
      expect(fs.readFileSync(path.join(dir, "same.md"), "utf8")).toBe("user edit");
    } finally { env.restore(); }
  });
  it("never claims or later deletes a colliding user file", () => {
    const env = setupTempEnv("skill-collision-");
    try {
      const dir = path.join(env.root, "skills");
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, "same.md"), "user");
      expect(() => projectSkillsToDir(dir, [{ id: "same", content: "managed" }], "flat")).toThrow("preserved local files");
      projectSkillsToDir(dir, [], "flat");
      expect(fs.readFileSync(path.join(dir, "same.md"), "utf8")).toBe("user");
    } finally { env.restore(); }
  });
  it("preserves edits when updating or pruning a managed skill", () => {
    const env = setupTempEnv("skill-drift-");
    try {
      const dir = path.join(env.root, "skills");
      projectSkillsToDir(dir, [{ id: "same", content: "managed" }], "flat");
      fs.writeFileSync(path.join(dir, "same.md"), "edited");
      expect(() => projectSkillsToDir(dir, [{ id: "same", content: "new" }], "flat")).toThrow();
      expect(() => projectSkillsToDir(dir, [], "flat")).toThrow();
      expect(fs.readFileSync(path.join(dir, "same.md"), "utf8")).toBe("edited");
    } finally { env.restore(); }
  });
});
