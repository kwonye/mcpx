import os from "node:os";
import { homeDir } from "../core/paths.js";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import type { ClientAdapter, ManagedIndex, McpxConfig, Skill, SyncClientOptions, SyncResult, PluginSyncInput, PluginSyncResult } from "../types.js";
import { syncPluginsToClient } from "../core/plugin-projections.js";
import { projectSkillsToDir } from "../core/skill-projections.js";
import { readJsonFile, writeJsonAtomic } from "../util/fs.js";
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

interface ClineConfig {
  mcpServers?: Record<string, unknown>;
}

const HTTP_TRANSPORT_TYPES = new Set(["http", "sse", "streamableHttp"]);

const stringMapSchema = z.record(z.string(), z.string());
const clineEntrySchema = z.object({
  // Cline now supports the standard MCP `type` field (camelCase values like
  // "streamableHttp") in addition to the legacy `transportType` field.
  type: z.string().optional(),
  transportType: z.string().optional(),
  url: z.string().min(1).optional(),
  headers: stringMapSchema.optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: stringMapSchema.optional(),
  cwd: z.string().min(1).optional(),
  disabled: z.boolean().optional()
}).passthrough();

function getCandidatePaths(): string[] {
    if (process.platform === "linux") {
      return [
        path.join(homeDir(), ".config", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"),
        path.join(homeDir(), ".config", "Cursor", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"),
        path.join(homeDir(), ".cline", "settings", "cline_mcp_settings.json")
      ];
    }
    if (process.platform === "win32") {
      return [
        path.join(process.env.APPDATA ?? "", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"),
        path.join(process.env.APPDATA ?? "", "Cursor", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"),
        path.join(homeDir(), ".cline", "settings", "cline_mcp_settings.json")
      ];
    }
    return [
      path.join(homeDir(), "Library", "Application Support", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"),
      path.join(homeDir(), "Library", "Application Support", "Cursor", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"),
      // Cline CLI stores MCP config at ~/.cline/settings/cline_mcp_settings.json
      // (resolveMcpSettingsPath in @cline/shared/storage).
      path.join(homeDir(), ".cline", "settings", "cline_mcp_settings.json")
    ];
  }

export class ClineAdapter implements ClientAdapter {
  readonly id = "cline" as const;

  detectConfigPath(): string | null {
    const candidates = getCandidatePaths();
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return candidates[0] ?? null;
  }

  supportsHttp(): boolean {
    return true;
  }

  syncPlugins(plugins: PluginSyncInput[]): PluginSyncResult {
    return syncPluginsToClient(this.id, plugins);
  }

  syncSkills(skills: Skill[]): void {
    projectSkillsToDir(path.join(homeDir(), ".config", "cline", "skills"), skills, "dir");
  }

  scanForImports(_config: McpxConfig, managedIndex: ManagedIndex) {
    const configPath = this.detectConfigPath();
    const result = emptyImportScan(this.id, configPath ?? undefined);
    if (!configPath || !fs.existsSync(configPath)) {
      return result;
    }

    const raw = readJsonFile<ClineConfig>(configPath, {});
    const servers = {
      ...(raw.mcpServers ?? {})
    };

    for (const [name, rawEntry] of Object.entries(servers)) {
      if (isManagedGatewayProjection(name) || managedIndex.managed[this.id]?.entries?.[name]) {
        continue;
      }

      const parsed = clineEntrySchema.safeParse(rawEntry);
      if (!parsed.success) {
        result.skipped.push(buildImportSkip(this.id, name, "Entry could not be mapped to an mcpx server.", configPath));
        continue;
      }

      const entry = parsed.data;
      // Cline uses both `type` (newer standard field) and `transportType` (legacy).
      // Prefer `type` when present; fall back to `transportType`.
      const transport = entry.type ?? entry.transportType;
      if ((transport === undefined || HTTP_TRANSPORT_TYPES.has(transport)) && entry.url && !entry.command) {
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

      if ((transport === undefined || transport === "stdio") && entry.command && !entry.url) {
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
      return errorResult(this.id, undefined, "Unable to resolve Cline MCP config path.");
    }
    if (!fs.existsSync(configPath)) {
      return okResult(this.id, configPath, "Cline config not found; skipping sync.");
    }

    try {
      const raw = readJsonFile<ClineConfig>(configPath, {});
      const servers = {
        ...(raw.mcpServers ?? {})
      };
      removeSourceEntries(servers, options.sourceEntriesToRemove);
      const managedNames = options.managedEntries.map((entry) => entry.name);
      const enabledEntries = options.managedEntries.filter((entry) => entry.enabled);
      const enabledManagedNames = enabledEntries.map((entry) => entry.name);
      const serverEntries = Object.fromEntries(
        enabledEntries.map((entry) => [entry.name, {
          type: "streamableHttp",
          url: entry.url,
          headers: entry.headers,
        }])
      ) as Record<string, unknown>;
      
      const driftedNames = enabledManagedNames.filter((name) =>
        detectManagedEntryDrift(options.managedIndex, this.id, name, servers[name])
      );
      
      for (const name of enabledManagedNames) {
        const conflict = ensureManagedEntryWritable(
          options.managedIndex,
          this.id,
          name,
          servers[name]
        );
        if (conflict) {
          return errorResult(this.id, configPath, conflict);
        }
      }

      pruneStaleManagedEntries(options.managedIndex, this.id, servers, enabledManagedNames);
      for (const [name, entry] of Object.entries(serverEntries)) {
        servers[name] = entry;
      }

      const next: ClineConfig = {
        ...raw,
        mcpServers: servers
      };

      writeJsonAtomic(configPath, next);
      setManagedEntries(
        options.managedIndex,
        this.id,
        configPath,
        Object.fromEntries(Object.entries(serverEntries).map(([name, entry]) => [name, JSON.stringify(entry)]))
      );
      return { ...okResult(this.id, configPath), driftedEntries: driftedNames.length > 0 ? driftedNames : undefined };
    } catch (error) {
      return errorResult(this.id, configPath, (error as Error).message);
    }
  }
}
