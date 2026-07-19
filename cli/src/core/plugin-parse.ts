import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { PluginManifest, DiscoveredComponents, DiscoveredComponent, DiscoveredMcpServer, PluginComponent } from "../types.js";

const CLAUDE_PLUGIN_JSON_REL = path.join(".claude-plugin", "plugin.json");
const CODEX_PLUGIN_JSON_REL = path.join(".codex-plugin", "plugin.json");
const MCP_JSON_REL = ".mcp.json";
const HOOKS_JSON_REL = path.join("hooks", "hooks.json");
const SKILLS_DIR = "skills";
const COMMANDS_DIR = "commands";
const AGENTS_DIR = "agents";

const manifestSchema = z.object({
  name: z.string().optional(),
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
  for (const rel of [CLAUDE_PLUGIN_JSON_REL, CODEX_PLUGIN_JSON_REL]) {
    const candidate = path.join(pluginRoot, rel);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function readRawManifest(pluginRoot: string): RawManifest | null {
  const filePath = manifestPath(pluginRoot);
  if (!filePath) return null;
  try {
    return manifestSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return null;
  }
}

function sanitizeComponentId(id: string): string {
  const stripped = id.replace(/[\/\\]/g, "_").replace(/^\.+/, "");
  return stripped.length > 0 ? stripped : "unnamed";
}

export function readManifest(pluginRoot: string): PluginManifest | null {
  const raw = readRawManifest(pluginRoot);
  if (!raw) return null;
  const declaredCapabilities = ["skills", "commands", "agents", "hooks", "mcpServers", "lspServers", "apps", "settings", "outputStyles", "dependencies"]
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
    displayName: raw.interface?.displayName,
    category: raw.category ?? raw.interface?.category,
    declaredCapabilities,
  };
}

function declaredPaths(raw: RawManifest | null, key: "skills" | "commands" | "agents", fallback: string): string[] {
  const value = raw?.[key];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value;
  return [fallback];
}

function resolveWithinRoot(pluginRoot: string, declared: string): string | null {
  const resolved = path.resolve(pluginRoot, declared);
  const root = path.resolve(pluginRoot);
  return resolved === root || resolved.startsWith(root + path.sep) ? resolved : null;
}

interface Frontmatter {
  name?: string;
  description?: string;
}

function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) {
    return { frontmatter: {}, body: content };
  }
  const end = trimmed.indexOf("---", 3);
  if (end === -1) {
    return { frontmatter: {}, body: content };
  }
  const raw = trimmed.slice(3, end).trim();
  const body = trimmed.slice(end + 3).trimStart();
  const frontmatter: Frontmatter = {};
  for (const line of raw.split("\n")) {
    const sep = line.indexOf(":");
    if (sep !== -1) {
      const key = line.slice(0, sep).trim();
      const val = line.slice(sep + 1).trim();
      if (key === "name") frontmatter.name = val;
      if (key === "description") frontmatter.description = val;
    }
  }
  return { frontmatter, body };
}

function discoverSkills(pluginRoot: string, raw: RawManifest | null): DiscoveredComponent[] {
  const results: DiscoveredComponent[] = [];
  for (const declared of declaredPaths(raw, "skills", SKILLS_DIR)) try {
    const skillsDir = resolveWithinRoot(pluginRoot, declared);
    if (!skillsDir || !fs.existsSync(skillsDir)) continue;
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        // Flat .md files at skills/*.md
        if (entry.name.endsWith(".md")) {
          const skillPath = path.join(skillsDir, entry.name);
          const content = fs.readFileSync(skillPath, "utf8");
          const { frontmatter } = parseFrontmatter(content);
          results.push({
            id: sanitizeComponentId(frontmatter.name ?? path.basename(entry.name, ".md")),
            type: "skills",
            path: skillPath,
            description: frontmatter.description,
          });
        }
        continue;
      }
      // skills/<name>/SKILL.md
      const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md");
      if (fs.existsSync(skillMdPath)) {
        const content = fs.readFileSync(skillMdPath, "utf8");
        const { frontmatter } = parseFrontmatter(content);
        results.push({
          id: sanitizeComponentId(frontmatter.name ?? entry.name),
          type: "skills",
          path: skillMdPath,
          description: frontmatter.description,
        });
      }
    }
  } catch {
    // ignore
  }
  return results;
}

function discoverCommands(pluginRoot: string, raw: RawManifest | null): DiscoveredComponent[] {
  const results: DiscoveredComponent[] = [];
  for (const declared of declaredPaths(raw, "commands", COMMANDS_DIR)) try {
    const commandsDir = resolveWithinRoot(pluginRoot, declared);
    if (!commandsDir || !fs.existsSync(commandsDir)) continue;
    const entries = fs.readdirSync(commandsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        const cmdPath = path.join(commandsDir, entry.name);
        const content = fs.readFileSync(cmdPath, "utf8");
        const { frontmatter } = parseFrontmatter(content);
        results.push({
          id: sanitizeComponentId(frontmatter.name ?? path.basename(entry.name, ".md")),
          type: "commands",
          path: cmdPath,
          description: frontmatter.description,
        });
      }
    }
  } catch {
    // ignore
  }
  return results;
}

function discoverAgents(pluginRoot: string, raw: RawManifest | null): DiscoveredComponent[] {
  const results: DiscoveredComponent[] = [];
  for (const declared of declaredPaths(raw, "agents", AGENTS_DIR)) try {
    const agentsDir = resolveWithinRoot(pluginRoot, declared);
    if (!agentsDir || !fs.existsSync(agentsDir)) continue;
    const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        const agentPath = path.join(agentsDir, entry.name);
        const content = fs.readFileSync(agentPath, "utf8");
        const { frontmatter } = parseFrontmatter(content);
        results.push({
          id: sanitizeComponentId(frontmatter.name ?? path.basename(entry.name, ".md")),
          type: "agents",
          path: agentPath,
          description: frontmatter.description,
        });
      }
    }
  } catch {
    // ignore
  }
  return results;
}

function discoverHooks(pluginRoot: string, raw: RawManifest | null): DiscoveredComponent[] {
  const declared = typeof raw?.hooks === "string" ? raw.hooks : undefined;
  const hooksPath = declared
    ? resolveWithinRoot(pluginRoot, declared)
    : [path.join(pluginRoot, HOOKS_JSON_REL), path.join(pluginRoot, "hooks.json")].find(fs.existsSync) ?? null;
  if (!hooksPath || !fs.existsSync(hooksPath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    const hooks = Array.isArray(raw) ? raw : raw.hooks ?? [];
    return hooks.map((h: Record<string, string>, i: number) => ({
      id: h.id ?? `hook-${i}`,
      type: "hooks" as PluginComponent,
      path: hooksPath,
      description: h.description,
    }));
  } catch {
    return [];
  }
}

function discoverMcpServers(pluginRoot: string, raw: RawManifest | null): DiscoveredMcpServer[] {
  const declared = typeof raw?.mcpServers === "string" ? raw.mcpServers : undefined;
  const mcpPath = declared ? resolveWithinRoot(pluginRoot, declared) : path.join(pluginRoot, MCP_JSON_REL);
  if (!mcpPath || !fs.existsSync(mcpPath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    const servers = raw.mcpServers ?? {};
    return Object.entries(servers).map(([id, s]: [string, any]) => {
      const isHttp = s.type === "http" || typeof s.url === "string";
      return {
        id,
        transport: isHttp ? "http" as const : "stdio" as const,
        command: s.command ?? "",
        args: s.args,
        env: s.env,
        cwd: s.cwd,
        url: isHttp ? s.url : undefined,
        oauthResource: s.oauth_resource,
      };
    });
  } catch {
    return [];
  }
}

export function discoverComponents(pluginRoot: string): DiscoveredComponents {
  const raw = readRawManifest(pluginRoot);
  return {
    skills: discoverSkills(pluginRoot, raw),
    commands: discoverCommands(pluginRoot, raw),
    agents: discoverAgents(pluginRoot, raw),
    hooks: discoverHooks(pluginRoot, raw),
    mcpServers: discoverMcpServers(pluginRoot, raw),
  };
}

export function hasManifest(pluginRoot: string): boolean {
  return manifestPath(pluginRoot) !== null;
}

export function resolvePluginVars(value: string, pluginRoot: string, dataDir: string): string {
  return value
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRoot)
    .replace(/\$\{DATA\}/g, dataDir)
    .replace(/\$\{CLAUDE_PROJECT_DIR\}/g, pluginRoot);
}
