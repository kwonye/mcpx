import YAML from "yaml";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

export const agentSkillNameSchema = z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const agentSkillFrontmatterSchema = z.object({
  name: agentSkillNameSchema,
  description: z.string().min(1).max(1024).refine(value => value.trim().length > 0),
  license: z.string().optional(),
  compatibility: z.string().min(1).max(500).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  "allowed-tools": z.string().optional(),
}).passthrough();

export function parseAgentSkill(content: string, directoryName?: string) {
  const match = content.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) throw new Error("Agent Skills require YAML frontmatter with name and description");
  const frontmatter = agentSkillFrontmatterSchema.parse(YAML.parse(match[1]));
  if (directoryName !== undefined && frontmatter.name !== directoryName) {
    throw new Error(`Skill name "${frontmatter.name}" must match its directory "${directoryName}"`);
  }
  return frontmatter;
}

export function validateAgentSkillDirectory(directory: string, name = path.basename(directory)): void {
  const root = fs.realpathSync(directory);
  const visited = new Set<string>();
  const walk = (target: string): void => {
    const real = fs.realpathSync(target);
    if (real !== root && !real.startsWith(root + path.sep)) throw new Error("Skill link escapes its directory");
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      if (visited.has(real)) throw new Error("Skill contains a link cycle");
      visited.add(real);
      for (const entry of fs.readdirSync(target)) walk(path.join(target, entry));
      visited.delete(real);
    } else if (!stat.isFile()) throw new Error("Skills can contain only regular files and directories");
  };
  walk(root);
  parseAgentSkill(fs.readFileSync(path.join(root, "SKILL.md"), "utf8"), name);
}
