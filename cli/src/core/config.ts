import { z } from "zod";
import path from "node:path";
import fs from "node:fs";
import { normalizeServerSpecEnabled, type ClientId, type McpxConfig, type UpstreamServerSpec } from "../types.js";
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
  path: z.string()
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
  projects: z.record(z.string(), projectEntrySchema).default({})
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
    projects: {}
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
    projects: parsed.data.projects
  });
}

export function saveConfig(config: McpxConfig, configPath = getConfigPath()): void {
  config.servers = Object.fromEntries(
    Object.entries(config.servers).map(([name, spec]) => [name, normalizeServerSpecEnabled(spec)])
  );

  let serversToSave = { ...config.servers };
  if (configPath === getConfigPath() && config.projects) {
    for (const [projectPath, projectEntry] of Object.entries(config.projects)) {
      const localPath = path.join(projectPath, ".mcpx.json");
      if (fs.existsSync(localPath)) {
        try {
          const localConfig = loadProjectConfig(localPath);
          const projectName = localConfig.name || projectEntry.name || path.basename(projectPath);
          for (const serverName of Object.keys(localConfig.servers)) {
            const namespacedName = `${projectName}.${serverName}`;
            delete serversToSave[namespacedName];
          }
        } catch {
          // Ignore
        }
      }
    }
  }

  const cleanedConfig = {
    ...config,
    servers: serversToSave
  };
  writeJsonAtomic(configPath, cleanedConfig);
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
  
  for (const [projectPath, projectEntry] of Object.entries(config.projects)) {
    const localPath = path.join(projectPath, ".mcpx.json");
    if (!fs.existsSync(localPath)) {
      continue;
    }
    try {
      const localConfig = loadProjectConfig(localPath);
      const projectName = localConfig.name || projectEntry.name || path.basename(projectPath);
      
      for (const [serverName, spec] of Object.entries(localConfig.servers)) {
        const namespacedName = `${projectName}.${serverName}`;
        const normalized = normalizeServerSpecEnabled(spec);
        
        // If it's stdio and no CWD is defined, default to the project path!
        if (normalized.transport === "stdio" && !normalized.cwd) {
          normalized.cwd = projectPath;
        }
        
        config.servers[namespacedName] = normalized;
      }
    } catch {
      // Ignore errors when loading a project config so a bad local config doesn't crash the gateway.
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
  if (options.global) {
    const globalPath = getConfigPath();
    const config = loadConfig(globalPath);
    return {
      type: "global",
      configPath: globalPath,
      config,
      save: () => saveConfig(config, globalPath)
    };
  }

  const projectConfigPath = findProjectConfigPath();
  if (options.local || projectConfigPath) {
    const targetPath = projectConfigPath || path.join(process.cwd(), ".mcpx.json");
    const projectPath = path.dirname(targetPath);
    const projectConfig = loadProjectConfig(targetPath);
    
    // Create a dummy McpxConfig that redirects servers to projectConfig.servers
    const dummyConfig: McpxConfig = {
      schemaVersion: 1,
      name: projectConfig.name,
      gateway: {
        port: 37373,
        tokenRef: "secret://local_gateway_token",
        autoStart: true
      },
      servers: projectConfig.servers,
      clients: {}
    };

    return {
      type: "project",
      configPath: targetPath,
      projectPath,
      config: dummyConfig,
      save: () => {
        projectConfig.servers = dummyConfig.servers;
        saveProjectConfig(projectConfig, targetPath);
      }
    };
  }

  // Fallback to global if not local and no .mcpx.json is found
  const globalPath = getConfigPath();
  const config = loadConfig(globalPath);
  return {
    type: "global",
    configPath: globalPath,
    config,
    save: () => saveConfig(config, globalPath)
  };
}
