import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { mutateConfig } from "./config-store.js";
import { listSkills, validateSkillPackage } from "./skills.js";
import { getSkillsDir, ensureDir } from "./paths.js";
import type { UpstreamServerSpec } from "../types.js";
import { validateSkillId } from "./identifiers.js";

const ENVIRONMENT_FILE = "mcpx.environment.json";
const LOCK_FILE = "mcpx.environment.lock.json";

const packageEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["skill", "plugin"]),
  path: z.string().min(1),
  source: z.string().optional(),
});

const shareServerSchema = z.discriminatedUnion("transport", [
  z.object({ transport: z.literal("http"), url: z.url(), headers: z.record(z.string(), z.string()).optional(), enabled: z.boolean().default(true) }),
  z.object({ transport: z.literal("stdio"), command: z.string().min(1), args: z.array(z.string()).default([]), env: z.record(z.string(), z.string()).optional(), cwd: z.string().optional(), enabled: z.boolean().default(true) }),
]);

const environmentSchema = z.object({
  version: z.literal(1),
  generatedBy: z.string().min(1),
  servers: z.record(z.string(), shareServerSchema).default({}),
  skills: z.array(packageEntrySchema).default([]),
  plugins: z.array(packageEntrySchema).default([]),
  clients: z.array(z.string()).default([]),
  inputs: z.array(z.object({ name: z.string(), description: z.string().optional() })).default([]),
});

const lockSchema = z.object({
  version: z.literal(1),
  mcpxCompatibility: z.string().min(1),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  packages: z.record(z.string(), z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), revision: z.string().optional() })).default({}),
});

export type ShareEnvironment = z.infer<typeof environmentSchema>;
export type ShareLock = z.infer<typeof lockSchema>;

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function sha256Tree(root: string): string {
  const hash = crypto.createHash("sha256");
  const visit = (current: string, relative = "") => {
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === ".DS_Store" || entry.name === ".git") continue;
      const child = path.join(current, entry.name);
      const childRelative = path.join(relative, entry.name);
      hash.update(childRelative);
      if (entry.isDirectory()) visit(child, childRelative);
      else if (entry.isFile()) hash.update(fs.readFileSync(child));
    }
  };
  visit(root);
  return hash.digest("hex");
}

function copyDirectory(source: string, destination: string): void {
  ensureDir(destination);
  fs.cpSync(source, destination, { recursive: true, dereference: true, filter: (sourcePath) => !sourcePath.split(path.sep).includes(".git") && !sourcePath.endsWith(`${path.sep}.DS_Store`) });
}

function resolveSharePath(root: string, relativePath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) throw new Error(`Package path escapes the environment folder: ${relativePath}`);
  return resolved;
}

function scrubServer(name: string, spec: UpstreamServerSpec, inputs: Array<{ name: string; description?: string }>): Record<string, unknown> {
  const result: Record<string, unknown> = { transport: spec.transport, enabled: spec.enabled ?? true };
  if (spec.transport === "http") {
    const parsedUrl = new URL(spec.url);
    if (parsedUrl.username || parsedUrl.password || /(?:token|secret|key|password|auth)/i.test(parsedUrl.search)) {
      throw new Error(`Server ${name} URL contains credentials and cannot be shared`);
    }
    result.url = spec.url;
    if (spec.headers) {
      result.headers = Object.fromEntries(Object.entries(spec.headers).map(([key, value]) => {
        if (value.startsWith("secret://")) return [key, value];
        const inputName = `server.${name}.header.${key}`;
        inputs.push({ name: inputName, description: `HTTP header ${key} for ${name}` });
        return [key, `{{input:${inputName}}}`];
      }));
    }
  } else {
    if (path.isAbsolute(spec.command)) throw new Error(`Server ${name} uses an absolute command path and cannot be shared`);
    result.command = spec.command;
    result.args = spec.args ?? [];
    if (spec.cwd) {
      if (path.isAbsolute(spec.cwd)) throw new Error(`Server ${name} uses an absolute cwd and cannot be shared`);
      result.cwd = spec.cwd;
    }
    if (spec.env) {
      result.env = Object.fromEntries(Object.entries(spec.env).map(([key, value]) => {
        if (value.startsWith("secret://")) return [key, value];
        const inputName = `server.${name}.env.${key}`;
        inputs.push({ name: inputName, description: `Environment variable ${key} for ${name}` });
        return [key, `{{input:${inputName}}}`];
      }));
    }
  }
  return result;
}

function replaceInputs(value: unknown, inputs: Record<string, string>): unknown {
  if (typeof value === "string") {
    const match = value.match(/^\{\{input:([^}]+)\}\}$/);
    return match ? inputs[match[1]] ?? value : value;
  }
  if (Array.isArray(value)) return value.map((entry) => replaceInputs(entry, inputs));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replaceInputs(entry, inputs)]));
  return value;
}

export function exportEnvironment(destination: string, options: { skills?: string[]; plugins?: string[] } = {}): { environment: ShareEnvironment; lock: ShareLock } {
  const root = path.resolve(destination);
  ensureDir(root);
  const config = loadConfig();
  const inputs: Array<{ name: string; description?: string }> = [];
  const generatedServerNames = new Set(Object.values(config.plugins ?? {}).flatMap((plugin) => plugin.serverNames));
  const servers = Object.fromEntries(Object.entries(config.servers)
    .filter(([name]) => !generatedServerNames.has(name))
    .map(([name, spec]) => [name, scrubServer(name, spec, inputs)]));
  const packagesDir = path.join(root, "packages");
  ensureDir(packagesDir);
  const selectedSkills = listSkills().filter((skill) => !options.skills || options.skills.includes(skill.id));
  const skills = selectedSkills.map((skill) => {
    const packagePath = path.join(packagesDir, "skills", skill.id);
    ensureDir(path.dirname(packagePath));
    if (skill.root) copyDirectory(skill.root, packagePath);
    else {
      ensureDir(packagePath);
      fs.writeFileSync(path.join(packagePath, "SKILL.md"), skill.content, "utf8");
    }
    return { id: skill.id, kind: "skill" as const, path: `packages/skills/${skill.id}`, source: skill.source ?? "authored" };
  });
  const selectedPlugins = Object.values(config.plugins ?? {}).filter((plugin) => !options.plugins || options.plugins.includes(plugin.id) || options.plugins.includes(plugin.name));
  const plugins = selectedPlugins.map((plugin) => {
    const packagePath = path.join(packagesDir, "plugins", plugin.name);
    copyDirectory(plugin.root, packagePath);
    return { id: plugin.name, kind: "plugin" as const, path: `packages/plugins/${plugin.name}`, source: plugin.source };
  });
  const environment = environmentSchema.parse({ version: 1, generatedBy: "mcpx", servers, skills, plugins, clients: Object.keys(config.clients ?? {}), inputs });
  const manifestPath = path.join(root, ENVIRONMENT_FILE);
  fs.writeFileSync(manifestPath, JSON.stringify(environment, null, 2) + "\n", "utf8");
  const lock: ShareLock = {
    version: 1,
    mcpxCompatibility: "1",
    manifestSha256: sha256File(manifestPath),
    packages: Object.fromEntries([
      ...skills.map((entry) => [`${entry.kind}:${entry.id}`, { sha256: sha256Tree(path.join(root, entry.path)) }] as const),
      ...plugins.map((entry) => {
        const plugin = selectedPlugins.find((candidate) => candidate.name === entry.id);
        return [`${entry.kind}:${entry.id}`, { sha256: sha256Tree(path.join(root, entry.path)), revision: plugin?.resolvedSha }] as const;
      }),
    ])
  };
  fs.writeFileSync(path.join(root, LOCK_FILE), JSON.stringify(lock, null, 2) + "\n", "utf8");
  return { environment, lock };
}

export async function importEnvironment(sourceDirectory: string, options: { locked?: boolean; dryRun?: boolean; inputs?: Record<string, string> } = {}): Promise<{ importedSkills: string[]; importedPlugins: string[]; importedServers: string[]; missingInputs: string[] }> {
  const root = path.resolve(sourceDirectory);
  const manifestPath = path.join(root, ENVIRONMENT_FILE);
  const lockPath = path.join(root, LOCK_FILE);
  const environment = environmentSchema.parse(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  const lock = lockSchema.parse(JSON.parse(fs.readFileSync(lockPath, "utf8")));
  if (options.locked && lock.manifestSha256 !== sha256File(manifestPath)) throw new Error("Environment manifest does not match its lockfile");
  const allEntries = [...environment.skills, ...environment.plugins];
  for (const entry of allEntries) {
    const packagePath = resolveSharePath(root, entry.path);
    if (!fs.existsSync(packagePath)) throw new Error(`Missing package content: ${entry.path}`);
    if (entry.kind === "skill") validateSkillPackage(packagePath);
    const expected = lock.packages[`${entry.kind}:${entry.id}`]?.sha256;
    if (options.locked && expected && expected !== sha256Tree(packagePath)) throw new Error(`Package integrity check failed: ${entry.id}`);
  }
  const inputs = options.inputs ?? {};
  const missingInputs = environment.inputs.map((input) => input.name).filter((name) => !inputs[name]);
  if (options.dryRun) return { importedSkills: environment.skills.map((entry) => entry.id), importedPlugins: environment.plugins.map((entry) => entry.id), importedServers: Object.keys(environment.servers), missingInputs };
  const currentConfig = loadConfig();
  for (const entry of environment.skills) {
    validateSkillId(entry.id);
    const target = path.join(getSkillsDir(), entry.id);
    if (fs.existsSync(target) && sha256Tree(target) !== sha256Tree(resolveSharePath(root, entry.path))) throw new Error(`Skill already exists with different content: ${entry.id}`);
  }
  for (const [name, raw] of Object.entries(environment.servers)) {
    if (currentConfig.servers[name] && JSON.stringify(currentConfig.servers[name]) !== JSON.stringify(replaceInputs(raw, inputs))) throw new Error(`Server already exists with different configuration: ${name}`);
  }
  for (const entry of environment.plugins) {
    if (Object.values(currentConfig.plugins ?? {}).some((plugin) => plugin.name === entry.id)) throw new Error(`Plugin already exists: ${entry.id}`);
  }
  const targetSkills = getSkillsDir();
  for (const entry of environment.skills) {
    validateSkillId(entry.id);
    const target = path.join(targetSkills, entry.id);
    if (fs.existsSync(target)) {
      if (sha256Tree(target) !== sha256Tree(resolveSharePath(root, entry.path))) throw new Error(`Skill already exists with different content: ${entry.id}`);
      continue;
    }
    copyDirectory(resolveSharePath(root, entry.path), target);
  }
  const importedPlugins: string[] = [];
  for (const entry of environment.plugins) {
    const packagePath = resolveSharePath(root, entry.path);
    const { installPlugin } = await import("./plugin-manager.js");
    await installPlugin(packagePath, { name: entry.id, enabled: true });
    importedPlugins.push(entry.id);
  }
  const importedServers: string[] = [];
  await mutateConfig((fresh) => {
    for (const [name, raw] of Object.entries(environment.servers)) {
      if (fresh.servers[name]) continue;
      fresh.servers[name] = replaceInputs(raw, inputs) as UpstreamServerSpec;
      importedServers.push(name);
    }
  });
  return { importedSkills: environment.skills.map((entry) => entry.id), importedPlugins, importedServers, missingInputs };
}
