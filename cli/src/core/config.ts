import { z } from "zod";
import { normalizeServerSpecEnabled, type ClientId, type McpxConfig } from "../types.js";
import { getConfigPath } from "./paths.js";
import { readJsonFile, writeJsonAtomic } from "../util/fs.js";

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
  clients: z.record(z.string(), clientStateSchema).default({})
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
    clients: {}
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

  return {
    schemaVersion: 1,
    gateway: parsed.data.gateway,
    servers,
    clients: clientEntries
  };
}

export function saveConfig(config: McpxConfig, configPath = getConfigPath()): void {
  config.servers = Object.fromEntries(
    Object.entries(config.servers).map(([name, spec]) => [name, normalizeServerSpecEnabled(spec)])
  );
  writeJsonAtomic(configPath, config);
}
