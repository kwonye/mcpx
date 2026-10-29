import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { setupTempEnv } from "./helpers.js";
import { projectSkillsToDir } from "../src/core/skill-projections.js";

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
const skill = (id: string, body = "Instructions") => ({ id, content: `---\nname: ${id}\ndescription: Test workflow\n---\n${body}` });
function fixture() { const env = setupTempEnv("skill-projection-"); cleanups.push(env.restore); return path.join(env.root, "skills"); }

describe("standard skill projections", () => {
  it("rejects flat output before writing", () => {
    const dir = fixture();
    expect(() => projectSkillsToDir(dir, [skill("review")], "flat")).toThrow("directories");
    expect(fs.existsSync(dir)).toBe(false);
  });
  it("projects, updates, and prunes complete skill directories", () => {
    const dir = fixture();
    projectSkillsToDir(dir, [skill("review"), skill("remove")], "dir");
    projectSkillsToDir(dir, [skill("review", "Updated")], "dir");
    expect(fs.readFileSync(path.join(dir, "review/SKILL.md"), "utf8")).toBe(skill("review", "Updated").content);
    expect(fs.existsSync(path.join(dir, "remove"))).toBe(false);
  });
  it("links supporting files and keeps the declared name as the directory name", () => {
    const dir = fixture(); const source = path.join(path.dirname(dir), "source/review");
    fs.mkdirSync(path.join(source, "references"), { recursive: true });
    fs.writeFileSync(path.join(source, "SKILL.md"), skill("review").content);
    fs.writeFileSync(path.join(source, "references/guide.md"), "Guide");
    projectSkillsToDir(dir, [{ ...skill("review"), root: source }], "dir");
    expect(fs.lstatSync(path.join(dir, "review")).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(dir, "review/references/guide.md"), "utf8")).toBe("Guide");
  });
  it("never claims or deletes a colliding user directory", () => {
    const dir = fixture(); fs.mkdirSync(path.join(dir, "review"), { recursive: true });
    fs.writeFileSync(path.join(dir, "review/SKILL.md"), "User content");
    expect(() => projectSkillsToDir(dir, [skill("review")], "dir")).toThrow("preserved local files");
    projectSkillsToDir(dir, [], "dir");
    expect(fs.readFileSync(path.join(dir, "review/SKILL.md"), "utf8")).toBe("User content");
  });
  it("preserves later edits during update and prune", () => {
    const dir = fixture(); projectSkillsToDir(dir, [skill("review")], "dir");
    fs.writeFileSync(path.join(dir, "review/SKILL.md"), "Edited");
    expect(() => projectSkillsToDir(dir, [skill("review", "New")], "dir")).toThrow();
    expect(() => projectSkillsToDir(dir, [], "dir")).toThrow();
    expect(fs.readFileSync(path.join(dir, "review/SKILL.md"), "utf8")).toBe("Edited");
  });
  it("migrates old directory receipts only when contents still match", () => {
    const dir = fixture(); fs.mkdirSync(path.join(dir, "review"), { recursive: true });
    fs.writeFileSync(path.join(dir, "review/SKILL.md"), skill("review").content);
    fs.writeFileSync(path.join(dir, "mcpx-skills.json"), JSON.stringify({ version: 1, paths: ["review"] }));
    projectSkillsToDir(dir, [skill("review")], "dir");
    projectSkillsToDir(dir, [skill("review", "Updated")], "dir");
    expect(fs.readFileSync(path.join(dir, "review/SKILL.md"), "utf8")).toBe(skill("review", "Updated").content);
  });
  it("preserves old flat files without treating them as skills", () => {
    const dir = fixture(); fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "review.md"), "User edit");
    fs.writeFileSync(path.join(dir, "mcpx-skills.json"), JSON.stringify({ version: 1, paths: ["review.md"] }));
    expect(() => projectSkillsToDir(dir, [skill("review")], "dir")).toThrow();
    expect(fs.readFileSync(path.join(dir, "review.md"), "utf8")).toBe("User edit");
    expect(JSON.parse(fs.readFileSync(path.join(dir, "mcpx-skills.json"), "utf8")).paths).toContain("review.md");
  });
});
