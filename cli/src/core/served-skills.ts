import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parseAgentSkill, agentSkillFrontmatterSchema } from "./agent-skills.js";
import type { z } from "zod";
import { listSkills } from "./skills.js";
import type { McpxConfig, Skill } from "../types.js";

export function skillVisible(config: McpxConfig, id: string, projectPath?: string): boolean {
  const origins = Object.values(config.origins ?? {}).filter(origin => origin.kind === "skill" && origin.id === id);
  return !origins.length || origins.some(origin => !origin.harness.includes("@") || origin.harness.slice(origin.harness.indexOf("@") + 1) === projectPath);
}
interface ServedSkill { uri: string; frontmatter: z.infer<typeof agentSkillFrontmatterSchema>; resources: Array<{ uri: string; digest: string; size: number }>; files: Map<string, Buffer> }
export function servedSkills(config: McpxConfig, projectPath?: string): ServedSkill[] {
  const skills: Skill[] = listSkills().filter(skill => (!skill.scope || skill.scope === projectPath) && skillVisible(config, skill.id, projectPath));
  for (const plugin of Object.values(config.plugins ?? {})) if (plugin.enabled && plugin.components.skills && plugin.approvals?.skills !== false) {
    const override = projectPath ? plugin.projectOverrides?.[projectPath] : undefined;
    if (override?.enabled === false || override?.components?.skills === false) continue;
    for (const skill of plugin.discovered.skills) {
      const file = path.basename(skill.path).toLowerCase() === "skill.md" ? skill.path : path.join(skill.path, "SKILL.md");
      if (fs.existsSync(file)) skills.push({ id: `${plugin.name}__${skill.id}`, root: path.dirname(file), content: fs.readFileSync(file, "utf8") });
    }
  }
  return skills.flatMap(skill => {
    try {
      const frontmatter = parseAgentSkill(skill.content, skill.root ? path.basename(skill.root) : undefined);
      const base = `skill://mcpx/${encodeURIComponent(skill.id)}/${frontmatter.name}`;
      const files = new Map<string, Buffer>();
      let total = 0;
      const add = (relative: string, content: Buffer) => {
        total += content.byteLength;
        if (total > 16 * 1024 * 1024 || files.size >= 512) throw new Error("Skill exceeds protocol limits");
        files.set(`${base}/${relative.split(path.sep).map(encodeURIComponent).join("/")}`, content);
      };
      if (skill.root) {
        const root = fs.realpathSync(skill.root);
        const visited = new Set<string>();
        const walk = (directory: string, prefix = "") => {
          const real = fs.realpathSync(directory);
          if (visited.has(real)) throw new Error("Skill contains a link cycle");
          visited.add(real);
          for (const name of fs.readdirSync(directory).sort()) {
            const target = path.join(directory, name), resolved = fs.realpathSync(target);
            if (!resolved.startsWith(root + path.sep)) throw new Error("Skill link escapes its root");
            const relative = prefix ? `${prefix}/${name}` : name;
            if (fs.statSync(target).isDirectory()) walk(target, relative);
            else add(relative, fs.readFileSync(target));
          }
          visited.delete(real);
        };
        walk(root);
      } else add("SKILL.md", Buffer.from(skill.content));
      return [{ uri: `${base}/SKILL.md`, frontmatter, resources: Array.from(files, ([uri, content]) => ({ uri, digest: `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`, size: content.byteLength })), files }];
    } catch { return []; }
  }).sort((a, b) => a.uri.localeCompare(b.uri));
}
export function listServedSkills(config: McpxConfig, projectPath?: string, cursor?: string) {
  const start = cursor ? Number(Buffer.from(cursor, "base64url").toString()) : 0;
  if (!Number.isSafeInteger(start) || start < 0) throw new Error("Invalid skills cursor");
  const all = servedSkills(config, projectPath);
  return { resultType: "complete", skills: all.slice(start, start + 50).map(({ files, ...entry }) => entry), ...(start + 50 < all.length ? { nextCursor: Buffer.from(String(start + 50)).toString("base64url") } : {}), ttlMs: 0, cacheScope: "private" };
}
export function getServedSkill(config: McpxConfig, uri: string, projectPath?: string) {
  const entry = servedSkills(config, projectPath).find(skill => skill.uri === uri);
  if (!entry) throw new Error("Unknown skill URI");
  const { files, ...skill } = entry;
  return { resultType: "complete", skill, ttlMs: 0, cacheScope: "private" };
}
export function readServedSkill(config: McpxConfig, uri: string, projectPath?: string) {
  const content = servedSkills(config, projectPath).flatMap(skill => Array.from(skill.files)).find(([file]) => file === uri)?.[1];
  if (!content) throw new Error("Unknown skill resource");
  const text = /\.(md|txt|json|ya?ml|csv|ts|js|py|sh|html|css)$/i.test(uri);
  const mimeType = uri.endsWith(".md") ? "text/markdown" : text ? "text/plain" : "application/octet-stream";
  return { resultType: "complete", contents: [{ uri, mimeType, ...(text ? { text: content.toString("utf8") } : { blob: content.toString("base64") }) }], ttlMs: 0, cacheScope: "private" };
}
