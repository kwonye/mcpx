import fs from "node:fs";
import path from "node:path";
import type { Skill } from "../types.js";
import { z } from "zod";
import { parseAgentSkill } from "./agent-skills.js";
import { validateSkillId } from "./identifiers.js";
import { pathFingerprint } from "./file-state.js";
import { writeJsonAtomic } from "../util/fs.js";

const OWNERSHIP_MANIFEST = "mcpx-skills.json";
const ownershipSchema = z.object({
  version: z.literal(1),
  paths: z.array(z.string()),
  hashes: z.record(z.string(), z.string()).default({}),
});

function within(base: string, relative: string): string {
  const target = path.resolve(base, relative);
  if (!relative || target === path.resolve(base) || !target.startsWith(path.resolve(base) + path.sep)) throw new Error("Invalid skill projection path");
  return target;
}

export function projectSkillsToDir(targetDir: string, skills: Skill[], layout: "dir" | "flat"): void {
  if (layout !== "dir") throw new Error("Agent Skills must be projected as directories containing SKILL.md");
  skills = skills.map(skill => {
    const metadata = parseAgentSkill(skill.content);
    if (skill.projectionPath && path.basename(skill.projectionPath) !== metadata.name) throw new Error("Skill projection directory must match its name");
    return { ...skill, projectionPath: skill.projectionPath ?? metadata.name };
  });
  const manifestPath = path.join(targetDir, OWNERSHIP_MANIFEST);
  let owned: z.infer<typeof ownershipSchema> = { version: 1, paths: [], hashes: {} };
  if (fs.existsSync(manifestPath)) {
    // Fail closed: corrupt ownership cannot authorize overwriting or deletion.
    owned = ownershipSchema.parse(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  }
  const wanted = new Set(skills.map(skill => skill.projectionPath ?? skill.id));
  const written: Record<string, string> = {};
  const retained = new Set<string>();
  const conflicts: string[] = [];
  for (const relative of owned.paths) {
    const target = within(targetDir, relative);
    const current = pathFingerprint(target);
    if (!wanted.has(relative) && current !== null) {
      if (owned.hashes[relative] === current) fs.rmSync(target, { recursive: true, force: true });
      else { conflicts.push(relative); retained.add(relative); if (owned.hashes[relative]) written[relative] = owned.hashes[relative]; }
    }
  }
  for (const skill of skills) {
    validateSkillId(skill.id);
    const relative = skill.projectionPath ?? skill.id;
    const target = within(targetDir, relative);
    const current = pathFingerprint(target);
    if (current !== null && owned.paths.includes(relative) && !owned.hashes[relative]) {
      // Old manifests lacked hashes. Migrate only projections matching their source.
      const stat = fs.lstatSync(target);
      let matches = false;
      if (skill.root && fs.existsSync(skill.root)) matches = stat.isSymbolicLink() ? fs.realpathSync(target) === fs.realpathSync(skill.root) : current === pathFingerprint(skill.root);
      else if (stat.isDirectory() && fs.readdirSync(target).length === 1) {
        const file = path.join(target, "SKILL.md");
        matches = fs.existsSync(file) && fs.lstatSync(file).isFile() && fs.readFileSync(file, "utf8") === skill.content;
      }
      if (matches) owned.hashes[relative] = current;
    }
    if (current !== null && (!owned.paths.includes(relative) || owned.hashes[relative] !== current)) {
      conflicts.push(relative);
      if (owned.paths.includes(relative)) retained.add(relative);
      if (owned.hashes[relative]) written[relative] = owned.hashes[relative];
      continue;
    }
    if (skill.root && fs.existsSync(skill.root)) {
      if (path.resolve(target) === path.resolve(skill.root)) continue; // canonical source is never a projection
      if (current !== null) fs.rmSync(target, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      try { fs.symlinkSync(path.relative(path.dirname(target), path.resolve(skill.root)), target, process.platform === "win32" ? "junction" : "dir"); }
      catch { fs.cpSync(skill.root, target, { recursive: true, dereference: true }); }
    } else {
      const file = path.join(target, "SKILL.md");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, skill.content, { mode: 0o600 });
    }
    written[relative] = pathFingerprint(target)!;
  }
  writeJsonAtomic(manifestPath, { version: 1, paths: [...new Set([...Object.keys(written), ...retained])], hashes: written });
  if (conflicts.length) throw new Error(`Skill projections preserved local files: ${conflicts.join(", ")}`);
}
