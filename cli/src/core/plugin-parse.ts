import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { parseAgentSkill, validateAgentSkillDirectory } from "./agent-skills.js";
import type { PluginManifest, DiscoveredComponents, DiscoveredComponent, DiscoveredMcpServer } from "../types.js";

const CLAUDE_PLUGIN_JSON_REL = path.join(".claude-plugin", "plugin.json");
const CURSOR_PLUGIN_JSON_REL = path.join(".cursor-plugin", "plugin.json");
const CODEX_PLUGIN_JSON_REL = path.join(".codex-plugin", "plugin.json");
const AGENT_PLUGIN_JSON_REL = "plugin.json";
const MCP_JSON_RELS = ["mcp.json", ".mcp.json"];

const manifestSchema = z.object({
  name: z.string().optional(),
  displayName: z.string().optional(),
  version: z.string().optional(),
  description: z.string().optional(),
  source: z.string().optional(),
  icon: z.string().optional(),
  assets: z.array(z.string()).optional(),
  entry: z.string().optional(),
  author: z.object({ name: z.string(), email: z.string().optional(), url: z.string().optional() }).optional(),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  license: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  category: z.string().optional(),
  skills: z.union([z.string(), z.array(z.string())]).optional(),
  commands: z.union([z.string(), z.array(z.string())]).optional(),
  agents: z.union([z.string(), z.array(z.string())]).optional(),
  hooks: z.unknown().optional(),
  mcpServers: z.unknown().optional(),
  lspServers: z.unknown().optional(),
  apps: z.unknown().optional(),
  settings: z.unknown().optional(),
  outputStyles: z.unknown().optional(),
  dependencies: z.unknown().optional(),
  interface: z.object({
    displayName: z.string().optional(),
    shortDescription: z.string().optional(),
    category: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

type RawManifest = z.infer<typeof manifestSchema>;

function manifestPath(pluginRoot: string): string | null {
  for (const rel of [AGENT_PLUGIN_JSON_REL, CLAUDE_PLUGIN_JSON_REL, CODEX_PLUGIN_JSON_REL, CURSOR_PLUGIN_JSON_REL]) {
    const candidate = path.join(pluginRoot, rel);
    if (fs.existsSync(candidate)) return resolveWithinRoot(pluginRoot, rel);
  }
  return null;
}

function readRawManifest(pluginRoot: string): RawManifest | null {
  const filePath = manifestPath(pluginRoot);
  if (!filePath) return null;
  return manifestSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

export function readManifest(pluginRoot: string): PluginManifest | null {
  const raw = readRawManifest(pluginRoot);
  if (!raw) return null;
  const declaredCapabilities = ["skills", "commands", "agents", "hooks", "mcpServers", "lspServers", "apps", "settings", "outputStyles", "dependencies", "rules"]
    .filter((key) => raw[key as keyof RawManifest] !== undefined);
  return {
    name: raw.name ?? path.basename(pluginRoot),
    version: raw.version ?? "0.0.0",
    description: raw.description ?? raw.interface?.shortDescription,
    source: raw.source,
    icon: raw.icon,
    assets: raw.assets,
    entry: raw.entry,
    author: raw.author,
    homepage: raw.homepage,
    repository: raw.repository,
    license: raw.license,
    keywords: raw.keywords,
    displayName: raw.displayName ?? raw.interface?.displayName,
    category: raw.category ?? raw.interface?.category,
    declaredCapabilities,
  };
}

function resolveWithinRoot(root: string, relative: string): string {
  const base = fs.realpathSync(root);
  const target = path.resolve(root, relative);
  if (target !== path.resolve(root) && !target.startsWith(path.resolve(root) + path.sep)) throw new Error(`Plugin path escapes its root: ${relative}`);
  if (fs.existsSync(target)) {
    const real = fs.realpathSync(target);
    if (real !== base && !real.startsWith(base + path.sep)) throw new Error(`Plugin link escapes its root: ${relative}`);
  }
  return target;
}

export function discoverComponents(root: string): DiscoveredComponents {
  const raw = readRawManifest(root);
  const skills: DiscoveredComponent[] = [];
  const add = (directory: string) => {
    const file = path.join(directory, "SKILL.md");
    if (!fs.existsSync(file)) return;
    const metadata = parseAgentSkill(fs.readFileSync(file, "utf8"), path.basename(directory));
    validateAgentSkillDirectory(directory, metadata.name);
    if (!skills.some(skill => skill.path === file)) skills.push({ id: metadata.name, type: "skills", path: file, description: metadata.description });
  };
  if (fs.existsSync(path.join(root, "SKILL.md"))) add(root);
  const declared = typeof raw?.skills === "string" ? [raw.skills] : raw?.skills ?? ["skills"];
  for (const relative of declared) {
    const directory = resolveWithinRoot(root, relative);
    if (!fs.existsSync(directory)) continue;
    if (path.basename(directory) === "SKILL.md") { add(path.dirname(directory)); continue; }
    if (fs.existsSync(path.join(directory, "SKILL.md"))) { add(directory); continue; }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) if (entry.isDirectory()) add(resolveWithinRoot(root, path.relative(root, path.join(directory, entry.name))));
  }
  const mcpServers: DiscoveredMcpServer[] = [];
  const declaredMcp = typeof raw?.mcpServers === "object" && raw.mcpServers !== null ? raw.mcpServers : undefined;
  const mcpFile = typeof raw?.mcpServers === "string" ? resolveWithinRoot(root, raw.mcpServers) : MCP_JSON_RELS.map(relative => resolveWithinRoot(root, relative)).find(fs.existsSync);
  const document = declaredMcp ?? (mcpFile && fs.existsSync(mcpFile) ? JSON.parse(fs.readFileSync(mcpFile, "utf8")) : undefined);
  if (document) {
    const data = z.record(z.string(), z.unknown()).parse(document);
    const entries = z.record(z.string(), z.unknown()).parse(data.mcpServers ?? data);
    const schema = z.object({ type: z.enum(["http", "streamable-http", "stdio"]).optional(), url: z.url().optional(), command: z.string().min(1).optional(), args: z.array(z.string()).optional(), env: z.record(z.string(), z.string()).optional(), headers: z.record(z.string(), z.string()).optional(), cwd: z.string().optional() }).passthrough();
    for (const [id, value] of Object.entries(entries)) {
      const entry = schema.parse(value);
      if (Boolean(entry.url) === Boolean(entry.command)) throw new Error(`MCP server ${id} requires exactly one of url or command`);
      if (entry.url && entry.type === "stdio" || entry.command && ["http", "streamable-http"].includes(entry.type ?? "")) throw new Error(`MCP transport does not match server ${id}`);
      mcpServers.push({ id, transport: entry.url ? "http" : "stdio", command: entry.command ?? "", args: entry.args, env: entry.env, headers: entry.headers, cwd: entry.cwd, url: entry.url });
    }
  }
  return { skills, mcpServers, commands: [], agents: [], hooks: [] };
}

export function hasManifest(root: string): boolean { return manifestPath(root) !== null || fs.existsSync(path.join(root, "SKILL.md")) || fs.existsSync(path.join(root, "skills")); }

export function resolvePluginVars(value: string, pluginRoot: string, dataDir: string): string {
  return value.replace(/\$\{(?:CLAUDE_PLUGIN_ROOT|CURSOR_PLUGIN_ROOT|MCPX_PLUGIN_ROOT)\}/g, pluginRoot)
    .replace(/\$\{(?:CLAUDE_PLUGIN_DATA|MCPX_PLUGIN_DATA|DATA)\}/g, dataDir);
}
