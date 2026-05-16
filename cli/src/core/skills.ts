import fs from "node:fs";
import path from "node:path";
import { getSkillsDir, ensureDir } from "./paths.js";
import type { Skill } from "../types.js";

export function listSkills(): Skill[] {
  const skillsDir = getSkillsDir();
  if (!fs.existsSync(skillsDir)) {
    return [];
  }

  const files = fs.readdirSync(skillsDir);
  const skills: Skill[] = [];

  for (const file of files) {
    if (file.endsWith(".md")) {
      const id = path.basename(file, ".md");
      const content = fs.readFileSync(path.join(skillsDir, file), "utf-8");
      skills.push({ id, content });
    }
  }

  return skills;
}

export function getSkill(id: string): Skill | null {
  const skillsDir = getSkillsDir();
  const filePath = path.join(skillsDir, `${id}.md`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  return { id, content };
}

export function saveSkill(id: string, content: string): void {
  const skillsDir = getSkillsDir();
  ensureDir(skillsDir);

  const filePath = path.join(skillsDir, `${id}.md`);
  fs.writeFileSync(filePath, content, "utf-8");
}

export function deleteSkill(id: string): void {
  const skillsDir = getSkillsDir();
  const filePath = path.join(skillsDir, `${id}.md`);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
