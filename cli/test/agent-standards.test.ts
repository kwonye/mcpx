import { afterEach, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { setupTempEnv } from "./helpers.js";
import { parseAgentSkill } from "../src/core/agent-skills.js";
import { readAgentInstructions } from "../src/core/agent-instructions.js";
import { saveSkill, installSkillFromSource, listSkills } from "../src/core/skills.js";
import { getSkillsDir } from "../src/core/paths.js";

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

it("parses YAML field order, quotes, multiline descriptions, CRLF, and extension fields without changing metadata", () => {
  const content = '---\r\ndescription: >\r\n  Review code\r\n  when requested.\r\nname: "code-review"\r\nmetadata:\r\n  version: "1"\r\nlicense: MIT\r\ncompatibility: Requires git\r\nallowed-tools: Read\r\ncustom: true\r\n---\r\n# Instructions';
  expect(parseAgentSkill(content, "code-review")).toEqual({ name: "code-review", description: "Review code when requested.\n", metadata: { version: "1" }, license: "MIT", compatibility: "Requires git", "allowed-tools": "Read", custom: true });
});

it("rejects malformed metadata and mismatching directory names", () => {
  for (const name of ["UPPER", "a--b", "trailing-", "../escape", "a".repeat(65)]) {
    expect(() => parseAgentSkill(`---\nname: ${name}\ndescription: Valid\n---\n`)).toThrow();
  }
  for (const description of ["", " ", "a".repeat(1025)]) expect(() => parseAgentSkill(`---\nname: review\ndescription: ${JSON.stringify(description)}\n---\n`)).toThrow();
  expect(() => parseAgentSkill("---\nname: review\ndescription: Valid\nmetadata:\n  version: 1\n---\n")).toThrow();
  expect(() => parseAgentSkill("---\nname: review\ndescription: Valid\n---\n", "other")).toThrow("must match");
});

it("validates authored skills before writing and preserves a previous valid version", () => {
  const env = setupTempEnv("standards-save-"); cleanups.push(env.restore);
  const valid = "---\nname: review\ndescription: Review code\n---\nBody";
  saveSkill("review", valid);
  expect(() => saveSkill("review", "invalid")).toThrow();
  expect(fs.readFileSync(path.join(getSkillsDir(), "review/SKILL.md"), "utf8")).toBe(valid);
});

it("reads plain Markdown AGENTS.md from root to nearest scope and ignores vendor instructions", () => {
  const env = setupTempEnv("standards-instructions-"); cleanups.push(env.restore);
  fs.mkdirSync(path.join(env.root, "cli/src"), { recursive: true });
  fs.writeFileSync(path.join(env.root, "AGENTS.md"), "Root instructions");
  fs.writeFileSync(path.join(env.root, "cli/AGENTS.md"), "Nearest instructions override root conflicts");
  fs.writeFileSync(path.join(env.root, "cli/CLAUDE.md"), "Do not use this");
  const file = path.join(env.root, "cli/src/file.ts"); fs.writeFileSync(file, "");
  expect(readAgentInstructions(env.root, file).map(entry => entry.content)).toEqual(["Root instructions", "Nearest instructions override root conflicts"]);
  expect(() => readAgentInstructions(path.join(env.root, "cli"), env.root)).toThrow("outside");
  expect(() => readAgentInstructions(file)).toThrow("must be a directory");
});

it("keeps rollback revisions out of skill discovery and rejects escaping source links", async () => {
  const env = setupTempEnv("standards-package-"); cleanups.push(env.restore);
  const root = path.join(env.root, "review"); fs.mkdirSync(root);
  const file = path.join(root, "SKILL.md");
  fs.writeFileSync(file, "---\nname: review\ndescription: Review code\n---\nFirst version");
  const outside = path.join(env.root, "outside.txt"); fs.writeFileSync(outside, "Outside content");
  fs.symlinkSync(outside, path.join(root, "escape.txt"));
  await expect(installSkillFromSource(root)).rejects.toThrow("escapes");
  expect(listSkills()).toEqual([]);
  fs.unlinkSync(path.join(root, "escape.txt"));
  await installSkillFromSource(root);
  fs.appendFileSync(file, "\nUpdated");
  await installSkillFromSource(root);
  expect(listSkills().map(skill => skill.id)).toEqual(["review"]);
  expect(listSkills()[0].content).toContain("Updated");
});
