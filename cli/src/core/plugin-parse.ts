import fs from "node:fs";
import path from "node:path";
import type { PluginManifest, DiscoveredComponents, DiscoveredComponent, DiscoveredMcpServer, PluginComponent } from "../types.js";

const PLUGIN_JSON_REL = path.join(".claude-plugin", "plugin.json");
const MCP_JSON_REL = ".mcp.json";
const HOOKS_JSON_REL = path.join("hooks", "hooks.json");
const SKILLS_DIR = "skills";
const COMMANDS_DIR = "commands";
const AGENTS_DIR = "agents";

function sanitizeComponentId(id: string): string {
  const stripped = id.replace(/[\/\\]/g, "_").replace(/^\.+/, "");
  return stripped.length > 0 ? stripped : "unnamed";
}

export function readManifest(pluginRoot: string): PluginManifest | null {
  const manifestPath = path.join(pluginRoot, PLUGIN_JSON_REL);
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return {
      name: raw.name ?? path.basename(pluginRoot),
      version: raw.version ?? "0.0.0",
      description: raw.description,
      source: raw.source,
      icon: raw.icon,
      assets: raw.assets,
      entry: raw.entry,
    };
  } catch {
    return null;
  }
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

function discoverSkills(pluginRoot: string): DiscoveredComponent[] {
  const skillsDir = path.join(pluginRoot, SKILLS_DIR);
  if (!fs.existsSync(skillsDir)) return [];
  const results: DiscoveredComponent[] = [];
  try {
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

function discoverCommands(pluginRoot: string): DiscoveredComponent[] {
  const commandsDir = path.join(pluginRoot, COMMANDS_DIR);
  if (!fs.existsSync(commandsDir)) return [];
  const results: DiscoveredComponent[] = [];
  try {
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

function discoverAgents(pluginRoot: string): DiscoveredComponent[] {
  const agentsDir = path.join(pluginRoot, AGENTS_DIR);
  if (!fs.existsSync(agentsDir)) return [];
  const results: DiscoveredComponent[] = [];
  try {
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

function discoverHooks(pluginRoot: string): DiscoveredComponent[] {
  const hooksPath = path.join(pluginRoot, HOOKS_JSON_REL);
  if (!fs.existsSync(hooksPath)) return [];
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

function discoverMcpServers(pluginRoot: string): DiscoveredMcpServer[] {
  const mcpPath = path.join(pluginRoot, MCP_JSON_REL);
  if (!fs.existsSync(mcpPath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
    const servers = raw.mcpServers ?? {};
    return Object.entries(servers).map(([id, s]: [string, any]) => ({
      id,
      command: s.command ?? "",
      args: s.args,
      env: s.env,
      cwd: s.cwd,
    }));
  } catch {
    return [];
  }
}

export function discoverComponents(pluginRoot: string): DiscoveredComponents {
  return {
    skills: discoverSkills(pluginRoot),
    commands: discoverCommands(pluginRoot),
    agents: discoverAgents(pluginRoot),
    hooks: discoverHooks(pluginRoot),
    mcpServers: discoverMcpServers(pluginRoot),
  };
}

export function hasManifest(pluginRoot: string): boolean {
  return fs.existsSync(path.join(pluginRoot, PLUGIN_JSON_REL));
}

export function resolvePluginVars(value: string, pluginRoot: string, dataDir: string): string {
  return value
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRoot)
    .replace(/\$\{DATA\}/g, dataDir)
    .replace(/\$\{CLAUDE_PROJECT_DIR\}/g, pluginRoot);
}
