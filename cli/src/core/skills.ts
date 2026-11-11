import fs from "node:fs";
import path from "node:path";
import { getSkillsDir, getSkillPackagesRoot, getSkillStatePath, ensureDir } from "./paths.js";
import type { Skill } from "../types.js";
import { validateSkillId } from "./identifiers.js";
import { parseSource } from "./plugin-source.js";
import { PluginCache } from "./plugin-cache.js";
import { z } from "zod";
import YAML from "yaml";
import { parseAgentSkill, agentSkillNameSchema, validateAgentSkillDirectory } from "./agent-skills.js";

const skillStateSchema = z.record(z.string(), z.object({ source: z.string(), skillName: z.string().optional(), pinned: z.boolean().default(false), previousPath: z.string().optional() }));
type SkillState = z.infer<typeof skillStateSchema>;

function readSkillState(): SkillState {
  const statePath = getSkillStatePath();
  if (!fs.existsSync(statePath)) return {};
  try { return skillStateSchema.parse(JSON.parse(fs.readFileSync(statePath, "utf8"))); } catch { return {}; }
}

function writeSkillState(state: SkillState): void {
  ensureDir(path.dirname(getSkillStatePath()));
  fs.writeFileSync(getSkillStatePath(), JSON.stringify(state, null, 2) + "\n", "utf8");
}

export function validateSkillPackage(root: string): void {
  const skillPath = path.join(root, "SKILL.md");
  if (!fs.existsSync(skillPath)) throw new Error(`Agent Skill is missing SKILL.md: ${root}`);
  validateAgentSkillDirectory(root);
}

function installedSkills(): Skill[] {
  const root = getSkillPackagesRoot();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    const packageRoot = path.join(root, entry.name);
    const skillFile = path.join(packageRoot, "SKILL.md");
    if (!fs.existsSync(skillFile)) return [];
    try {
      const content = fs.readFileSync(skillFile, "utf8");
      parseAgentSkill(content, entry.name);
      return [{ id: entry.name, content, root: packageRoot, source: "installed" as const, readOnly: true }];
    } catch { return []; }
  });
}

export function listSkills(): Skill[] {
  const skillsDir = getSkillsDir();
  const skills: Skill[] = [];
  const files = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir, { withFileTypes: true }) : [];
  for (const file of files) {
    const id = file.isDirectory() ? file.name : null;
    if (id) {
      try {
        const root = file.isDirectory() ? path.join(skillsDir, id) : skillsDir;
        const filePath = file.isDirectory() ? path.join(root, "SKILL.md") : path.join(skillsDir, file.name);
        if (!fs.existsSync(filePath)) continue;
        const content = fs.readFileSync(filePath, "utf-8");
        parseAgentSkill(content, id);
        skills.push({ id, content, root: file.isDirectory() ? root : undefined, source: "authored" });
      } catch {
        console.error(`[mcpx] Warning: could not read skill ${file.name}`);
      }
    }
  }

  const authoredIds = new Set(skills.map((skill) => skill.id));
  return [...skills, ...installedSkills().filter((skill) => !authoredIds.has(skill.id))];
}

export function getSkill(id: string): Skill | null {
  validateSkillId(id);
  const skillsDir = getSkillsDir();
  const directory = path.join(skillsDir, id);
  const packagePath = path.join(directory, "SKILL.md");
  const filePath = packagePath;
  if (!fs.existsSync(filePath)) {
    const installedPath = path.join(getSkillPackagesRoot(), id, "SKILL.md");
    if (!fs.existsSync(installedPath)) return listSkills().find(skill => skill.id === id) ?? null;
    const installedRoot = path.dirname(installedPath);
    return { id, content: fs.readFileSync(installedPath, "utf8"), root: installedRoot, source: "installed", readOnly: true };
  }

  const content = fs.readFileSync(filePath, "utf-8");
  return { id, content, root: fs.existsSync(packagePath) ? directory : undefined, source: "authored" };
}

export function saveSkill(id: string, content: string): void {
  validateSkillId(id);
  parseAgentSkill(content, id);
  const skillsDir = getSkillsDir();
  ensureDir(skillsDir);

  const directory = path.join(skillsDir, id);
  const filePath = path.join(directory, "SKILL.md");
  ensureDir(directory);
  fs.writeFileSync(filePath, content, "utf-8");

  // Migrate the old flat representation only after verifying the new file.
  const legacyPath = path.join(skillsDir, `${id}.md`);
  if (fs.existsSync(legacyPath)) {
    if (fs.readFileSync(filePath, "utf-8") === fs.readFileSync(legacyPath, "utf-8")) fs.unlinkSync(legacyPath);
    else console.error(`[mcpx] Warning: preserving conflicting legacy skill file: ${legacyPath}`);
  }
}

export function deleteSkill(id: string): void {
  validateSkillId(id);
  const skillsDir = getSkillsDir();
  const directory = path.join(skillsDir, id);
  const filePath = path.join(directory, "SKILL.md");
  const legacyPath = path.join(skillsDir, `${id}.md`);
  const hadAuthored = fs.existsSync(directory) || fs.existsSync(legacyPath);
  if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
  if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
  if (!hadAuthored) {
    const installedPath = path.join(getSkillPackagesRoot(), id);
    if (fs.existsSync(installedPath)) fs.rmSync(installedPath, { recursive: true, force: true });
    const state = readSkillState();
    delete state[id];
    writeSkillState(state);
  }
}

export function customizeSkill(id: string, targetId = id): Skill {
  validateSkillId(id);
  validateSkillId(targetId);
  agentSkillNameSchema.parse(targetId);
  const existing = getSkill(id);
  if (!existing) throw new Error(`Skill "${id}" not found`);
  const frontmatter = parseAgentSkill(existing.content);
  const body = existing.content.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "");
  const content = `---\n${YAML.stringify({ ...frontmatter, name: targetId })}---\n${body}`;
  const destination = path.join(getSkillsDir(), targetId);
  if (targetId !== id && getSkill(targetId)) throw new Error(`Skill "${targetId}" already exists`);
  if (existing.root && path.resolve(existing.root) !== path.resolve(destination)) {
    validateAgentSkillDirectory(existing.root, frontmatter.name);
    ensureDir(path.dirname(destination));
    fs.cpSync(existing.root, destination, { recursive: true, dereference: true });
  }
  saveSkill(targetId, content);
  return getSkill(targetId)!;
}

export async function installSkillFromSource(source: string, skillName?: string): Promise<Skill> {
  const parsed = parseSource(source);
  if (parsed.type === "local" && fs.existsSync(path.join(source, "SKILL.md"))) validateSkillPackage(source);
  const cache = new PluginCache();
  const cached = await cache.fetch(parsed, skillName ?? "skill");
  const candidates: Array<{ id: string; root: string }> = [];
  const declaredName = (root: string): string | undefined => {
    try {
      const content = fs.readFileSync(path.join(root, "SKILL.md"), "utf8");
      return parseAgentSkill(content).name;
    } catch { return undefined; }
  };
  const addCandidate = (root: string, id = path.basename(root)) => {
    if (fs.existsSync(path.join(root, "SKILL.md"))) {
      const metadata = parseAgentSkill(fs.readFileSync(path.join(root, "SKILL.md"), "utf8"), root === cached.root ? undefined : path.basename(root));
      validateAgentSkillDirectory(root, metadata.name);
      candidates.push({ id: declaredName(root) ?? id, root });
    }
  };
  addCandidate(cached.root);
  const skillsRoot = path.join(cached.root, "skills");
  if (fs.existsSync(skillsRoot)) {
    for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) addCandidate(path.join(skillsRoot, entry.name), entry.name);
    }
  }
  if (candidates.length === 0) throw new Error(`No Agent Skill package found in ${source}`);
  const selected = skillName ? candidates.find((candidate) => candidate.id === skillName) : candidates[0];
  if (!selected) throw new Error(`Skill "${skillName}" was not found in ${source}`);
  validateSkillId(selected.id);
  const destination = path.join(getSkillPackagesRoot(), selected.id);
  ensureDir(path.dirname(destination));
  const state = readSkillState();
  const stateSource = parsed.type === "local" ? path.resolve(source) : source;
  if (fs.existsSync(destination)) {
    if (state[selected.id]?.pinned) throw new Error(`Skill "${selected.id}" is pinned; unpin it before updating`);
    const previousPath = `${destination}.previous`;
    if (fs.existsSync(previousPath)) fs.rmSync(previousPath, { recursive: true, force: true });
    fs.renameSync(destination, previousPath);
    state[selected.id] = { ...state[selected.id], source: stateSource, skillName: selected.id, pinned: false, previousPath };
  } else {
    state[selected.id] = { source: stateSource, skillName: selected.id, pinned: false };
  }
  fs.cpSync(selected.root, destination, { recursive: true, dereference: true });
  writeSkillState(state);
  return { id: selected.id, content: fs.readFileSync(path.join(destination, "SKILL.md"), "utf8"), root: destination, source: "installed", readOnly: true };
}

export function pinSkill(id: string): void {
  const state = readSkillState();
  if (!state[id]) throw new Error(`Skill "${id}" is not installed`);
  state[id].pinned = true;
  writeSkillState(state);
}

export function unpinSkill(id: string): void {
  const state = readSkillState();
  if (!state[id]) throw new Error(`Skill "${id}" is not installed`);
  state[id].pinned = false;
  writeSkillState(state);
}

export async function updateSkill(id: string): Promise<Skill> {
  const state = readSkillState();
  const entry = state[id];
  if (!entry) throw new Error(`Skill "${id}" is not installed`);
  if (entry.pinned) throw new Error(`Skill "${id}" is pinned; unpin it before updating`);
  return installSkillFromSource(entry.source, entry.skillName ?? id);
}

export function rollbackSkill(id: string): Skill {
  const state = readSkillState();
  const entry = state[id];
  if (!entry?.previousPath || !fs.existsSync(entry.previousPath)) throw new Error(`Skill "${id}" has no previous revision`);
  const destination = path.join(getSkillPackagesRoot(), id);
  const failedPath = `${destination}.failed`;
  if (fs.existsSync(failedPath)) fs.rmSync(failedPath, { recursive: true, force: true });
  fs.renameSync(destination, failedPath);
  fs.renameSync(entry.previousPath, destination);
  entry.previousPath = failedPath;
  writeSkillState(state);
  return { id, content: fs.readFileSync(path.join(destination, "SKILL.md"), "utf8"), root: destination, source: "installed", readOnly: true };
}
