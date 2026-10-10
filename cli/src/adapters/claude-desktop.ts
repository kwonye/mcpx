import { homeDir } from "../core/paths.js";
import path from "node:path";
import { z } from "zod";
import type { ClientAdapter, ManagedIndex, ManagedGatewayEntry, McpxConfig, Skill, SyncClientOptions, SyncResult, PluginSyncInput, PluginSyncResult } from "../types.js";
import { syncPluginsToClient } from "../core/plugin-projections.js";
import { projectSkillsToDir } from "../core/skill-projections.js";
import { localCliCommand } from "../core/runtime-entry.js";
import { readJsonStrict as readJsonFile, writeJsonAtomic } from "../util/fs.js";
import {
  buildImportSkip,
  detectManagedEntryDrift,
  emptyImportScan,
  ensureManagedEntryWritable,
  errorResult,
  isManagedGatewayProjection,
  okResult,
  pruneStaleManagedEntries,
  removeSourceEntries,
  setManagedEntries
} from "./utils/index.js";

type JsonObject = Record<string, unknown>;
const stringMapSchema = z.record(z.string(), z.string());
const claudeDesktopEntrySchema = z.object({
  type: z.string().optional(),
  url: z.string().min(1).optional(),
  headers: stringMapSchema.optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: stringMapSchema.optional(),
  cwd: z.string().min(1).optional(),
  disabled: z.boolean().optional()
}).passthrough();

// Claude Desktop's claude_desktop_config.json does not natively support
// HTTP/streamable-http transports — only stdio. mcpx therefore installs a
// stdio proxy bridge (`mcpx proxy <name>`) per managed server, mirroring the
// community mcp-remote pattern. supportsHttp() stays true because mcpx can
// still wire its gateway in via this bridge (returning false would make
// sync.ts skip the client as UNSUPPORTED_HTTP).
// See https://modelcontextprotocol.io/quickstart/user
function buildProxyEntry(entry: ManagedGatewayEntry): { command: string; args: string[]; env: Record<string, string> } {
  const upstreamName = entry.name.replace(/ \(mcpx\)$/, "");
  const cli = localCliCommand(["proxy", upstreamName]);
  const proxyToken = /^Bearer\s+(.+)$/i.exec(entry.headers.Authorization)?.[1];
  return {
    command: cli.command,
    args: cli.args,
    env: {
      ...cli.env,
      ...(cli.args[0] ? { MCPX_CLI_ENTRY: cli.args[0] } : {}),
      ...(proxyToken ? { MCPX_PROXY_TOKEN: proxyToken } : {})
    }
  };
}

export class ClaudeDesktopAdapter implements ClientAdapter {
  readonly id = "claude-desktop" as const;

  detectConfigPath(): string | null {
    if (process.platform === "linux") {
      return path.join(homeDir(), ".config", "Claude", "claude_desktop_config.json");
    }
    if (process.platform === "win32") {
      return path.join(process.env.APPDATA ?? "", "Claude", "claude_desktop_config.json");
    }
    return path.join(homeDir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }

  supportsHttp(): boolean {
    return true;
  }

  syncPlugins(plugins: PluginSyncInput[]): PluginSyncResult {
    return syncPluginsToClient(this.id, plugins);
  }

  syncSkills(skills: Skill[]): void {
    const configPath = this.detectConfigPath();
    if (!configPath) {
      return;
    }
    projectSkillsToDir(path.join(path.dirname(configPath), "skills"), skills, "dir");
  }

  scanForImports(_config: McpxConfig, managedIndex: ManagedIndex) {
    const configPath = this.detectConfigPath();
    const result = emptyImportScan(this.id, configPath ?? undefined);
    if (!configPath) {
      return result;
    }

    const raw = readJsonFile<JsonObject>(configPath, {});
    const topLevelServers = ((raw.mcpServers as JsonObject | undefined) ?? {}) as JsonObject;
    for (const [name, rawEntry] of Object.entries(topLevelServers)) {
      if (isManagedGatewayProjection(name) || managedIndex.managed[this.id]?.entries?.[name]) {
        continue;
      }

      const parsed = claudeDesktopEntrySchema.safeParse(rawEntry);
      if (!parsed.success) {
        result.skipped.push(buildImportSkip(this.id, name, "Entry could not be mapped to an mcpx server.", configPath));
        continue;
      }

      const entry = parsed.data;
      if ((entry.type === undefined || entry.type === "http" || entry.type === "streamable-http") && entry.url && !entry.command) {
        result.candidates.push({
          clientId: this.id,
          configPath,
          sourceEntryName: name,
          serverName: name,
          spec: {
            transport: "http",
            url: entry.url,
            headers: entry.headers,
            enabled: entry.disabled !== true
          }
        });
        continue;
      }

      if ((entry.type === undefined || entry.type === "stdio") && entry.command && !entry.url) {
        result.candidates.push({
          clientId: this.id,
          configPath,
          sourceEntryName: name,
          serverName: name,
          spec: {
            transport: "stdio",
            command: entry.command,
            args: entry.args,
            env: entry.env,
            cwd: entry.cwd,
            enabled: entry.disabled !== true
          }
        });
        continue;
      }

      result.skipped.push(buildImportSkip(this.id, name, "Entry must define exactly one transport that mcpx supports.", configPath));
    }

    return result;
  }

  syncGateway(_config: McpxConfig, options: SyncClientOptions): SyncResult {
    const configPath = this.detectConfigPath();
    if (!configPath) {
      return errorResult(this.id, undefined, "Unable to resolve Claude Desktop config path.");
    }

    try {
      const raw = readJsonFile<JsonObject>(configPath, {});
      const enabledEntries = options.managedEntries.filter((entry) => entry.enabled);
      const serverEntries = Object.fromEntries(
        enabledEntries.map((entry) => {
          const { command, args, env } = buildProxyEntry(entry);
          return [entry.name, { command, args, env }];
        })
      ) as Record<string, unknown>;
      const enabledManagedNames = enabledEntries.map((entry) => entry.name);

      const topLevelServers = ((raw.mcpServers as JsonObject | undefined) ?? {}) as JsonObject;
      removeSourceEntries(topLevelServers, options.sourceEntriesToRemove);
      
      const driftedNames = enabledManagedNames.filter((name) =>
        detectManagedEntryDrift(options.managedIndex, this.id, name, topLevelServers[name])
      );
      
      for (const name of enabledManagedNames) {
        const topLevelConflict = ensureManagedEntryWritable(
          options.managedIndex,
          this.id,
          name,
          topLevelServers[name]
        );
        if (topLevelConflict) {
          return errorResult(this.id, configPath, topLevelConflict);
        }
      }

      pruneStaleManagedEntries(options.managedIndex, this.id, topLevelServers, enabledManagedNames);
      for (const [name, entry] of Object.entries(serverEntries)) {
        topLevelServers[name] = entry;
      }
      raw.mcpServers = topLevelServers;

      writeJsonAtomic(configPath, raw);
      setManagedEntries(
        options.managedIndex,
        this.id,
        configPath,
        Object.fromEntries(
          enabledEntries.map((entry) => {
            const { command, args, env } = buildProxyEntry(entry);
            return [entry.name, JSON.stringify({ command, args, env })];
          })
        )
      );
      return { ...okResult(this.id, configPath), driftedEntries: driftedNames.length > 0 ? driftedNames : undefined };
    } catch (error) {
      return errorResult(this.id, configPath, (error as Error).message);
    }
  }
}
