import { z } from "zod";
import path from "node:path";
import fs from "node:fs";
import { normalizeServerSpecEnabled, type ClientId, type McpxConfig, type StdioServerSpec, type UpstreamServerSpec, type ManagedPlugin, type PluginComponent, type DiscoveredComponents } from "../types.js";
import { getConfigPath, findProjectConfigPath } from "./paths.js";
import { readJsonFile, writeJsonAtomic } from "../util/fs.js";
import { repairConfig } from "./config-repair.js";

const clientStateSchema = z.object({
  status: z.enum(["SYNCED", "UNSUPPORTED_HTTP", "ERROR", "SKIPPED"]),
  lastSyncAt: z.string().optional(),
  message: z.string().optional(),
  configPath: z.string().optional()
});

const httpServerSchema = z.object({
  transport: z.literal("http"),
  url: z.url(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().default(true)
});

const stdioServerSchema = z.object({
  transport: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().min(1).optional(),
  enabled: z.boolean().default(true)
});

const serverSchema = z.discriminatedUnion("transport", [httpServerSchema, stdioServerSchema]);

const projectEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  disabledServers: z.array(z.string()).default([])
});

const pluginComponentSchema = z.enum(["mcpServers", "skills", "hooks", "agents", "commands"]);

const discoveredComponentSchema = z.object({
  id: z.string(),
  type: pluginComponentSchema,
  path: z.string(),
  description: z.string().optional(),
});

const discoveredMcpServerSchema = z.object({
  id: z.string(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
});

const discoveredComponentsSchema = z.object({
  skills: z.array(discoveredComponentSchema).default([]),
  commands: z.array(discoveredComponentSchema).default([]),
  agents: z.array(discoveredComponentSchema).default([]),
  hooks: z.array(discoveredComponentSchema).default([]),
  mcpServers: z.array(discoveredMcpServerSchema).default([]),
});

const managedPluginSchema = z.object({
  id: z.string(),
  name: z.string(),
  source: z.string(),
  version: z.string(),
  ref: z.string(),
  resolvedSha: z.string(),
  installedAt: z.string(),
  root: z.string(),
  dataDir: z.string(),
  components: z.record(pluginComponentSchema, z.boolean()).default({} as Record<string, boolean>),
  discovered: discoveredComponentsSchema.default({} as unknown as DiscoveredComponents),
  enabled: z.boolean().default(true),
  status: z.enum(["healthy", "unhealthy", "preparing", "updating", "error"]).default("healthy"),
  error: z.string().optional(),
  serverNames: z.array(z.string()).default([]),
  projectedClients: z.array(z.string()).default([]),
  approvals: z.object({
    mcpServers: z.boolean().optional(),
    skills: z.boolean().optional(),
    hooks: z.boolean().optional(),
    agents: z.boolean().optional(),
    commands: z.boolean().optional(),
  }).optional(),
  projectOverrides: z.record(z.string(), z.object({
    enabled: z.boolean().optional(),
    components: z.record(pluginComponentSchema, z.boolean()).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })).optional(),
});

const configSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  gateway: z.object({
    port: z.number().int().min(1).max(65535).default(37373),
    tokenRef: z.string().default("secret://local_gateway_token"),
    autoStart: z.boolean().default(true)
  }).default({
    port: 37373,
    tokenRef: "secret://local_gateway_token",
    autoStart: true
  }),
  servers: z.record(z.string(), serverSchema).default({}),
  clients: z.record(z.string(), clientStateSchema).default({}),
  projects: z.record(z.string(), projectEntrySchema).default({}),
  plugins: z.record(z.string(), managedPluginSchema).default({})
});

export interface ProjectLocalConfig {
  name?: string;
  servers: Record<string, UpstreamServerSpec>;
}

const projectConfigSchema = z.object({
  name: z.string().min(1).optional(),
  servers: z.record(z.string(), serverSchema).default({})
});

export function defaultConfig(): McpxConfig {
  return {
    schemaVersion: 1,
    gateway: {
      port: 37373,
      tokenRef: "secret://local_gateway_token",
      autoStart: true
    },
    servers: {},
    clients: {},
    projects: {},
    plugins: {}
  };
}

export function loadConfig(configPath = getConfigPath()): McpxConfig {
  const raw = readJsonFile(configPath, defaultConfig());
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    return defaultConfig();
  }

  const clientEntries: Partial<Record<ClientId, McpxConfig["clients"][ClientId]>> = {};
  for (const [key, value] of Object.entries(parsed.data.clients)) {
    if (["claude", "claude-desktop", "codex", "cursor", "cline", "opencode", "kiro", "vscode", "qwen"].includes(key)) {
      clientEntries[key as ClientId] = value;
    }
  }

  const servers = Object.fromEntries(
    Object.entries(parsed.data.servers).map(([name, spec]) => [name, normalizeServerSpecEnabled(spec)])
  );

  return repairConfig({
    schemaVersion: 1,
    gateway: parsed.data.gateway,
    servers,
    clients: clientEntries,
    projects: parsed.data.projects,
    plugins: parsed.data.plugins
  });
}

export function saveConfig(config: McpxConfig, configPath = getConfigPath()): void {
  // Normalize in-place so callers see the resolved enabled flags after saving.
  config.servers = Object.fromEntries(
    Object.entries(config.servers).map(([name, spec]) => [name, normalizeServerSpecEnabled(spec)])
  );
  writeJsonAtomic(configPath, config);
}

export function loadProjectConfig(projectConfigPath: string): ProjectLocalConfig {
  const raw = readJsonFile(projectConfigPath, { servers: {} });
  const parsed = projectConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { servers: {} };
  }
  return parsed.data;
}

export function saveProjectConfig(config: ProjectLocalConfig, projectConfigPath: string): void {
  config.servers = Object.fromEntries(
    Object.entries(config.servers).map(([name, spec]) => [name, normalizeServerSpecEnabled(spec)])
  );
  writeJsonAtomic(projectConfigPath, config);
}

export function loadMergedConfig(configPath = getConfigPath()): McpxConfig {
  const config = loadConfig(configPath);

  if (!config.projects) {
    config.projects = {};
  }

  // Migrate legacy per-project .mcpx.json servers into the global catalog.
  // Servers are folded in under their plain name (no namespace prefix).
  // Skip any name that already exists in the catalog so the migration is idempotent.
  for (const [projectPath] of Object.entries(config.projects)) {
    const localPath = path.join(projectPath, ".mcpx.json");
    if (!fs.existsSync(localPath)) {
      continue;
    }
    try {
      const localConfig = loadProjectConfig(localPath);
      for (const [serverName, spec] of Object.entries(localConfig.servers)) {
        if (config.servers[serverName]) continue; // already in catalog
        const normalized = normalizeServerSpecEnabled(spec);
        if (normalized.transport === "stdio" && !(normalized as StdioServerSpec).cwd) {
          (normalized as StdioServerSpec & { enabled: boolean }).cwd = projectPath;
        }
        config.servers[serverName] = normalized;
      }
    } catch {
      // Ignore errors loading a project config so a bad local file doesn't crash the gateway.
    }
  }

  return config;
}

export interface ActiveConfigContext {
  type: "global" | "project";
  configPath: string;
  projectPath?: string;
  config: McpxConfig;
  save: () => void;
}

export function resolveActiveConfig(options: { global?: boolean; local?: boolean } = {}): ActiveConfigContext {
  const globalPath = getConfigPath();
  const config = loadConfig(globalPath);

  // Detect project context (informational — all writes still go to the global catalog)
  if (!options.global) {
    const projectConfigPath = findProjectConfigPath();
    if (options.local || projectConfigPath) {
      const projectPath = projectConfigPath ? path.dirname(projectConfigPath) : process.cwd();
      return {
        type: "project",
        configPath: globalPath,
        projectPath,
        config,
        save: () => saveConfig(config, globalPath)
      };
    }
  }

  return {
    type: "global",
    configPath: globalPath,
    config,
    save: () => saveConfig(config, globalPath)
  };
}
