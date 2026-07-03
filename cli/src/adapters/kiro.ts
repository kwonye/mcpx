import os from "node:os";
import fs from "node:fs";
import { homeDir } from "../core/paths.js";
import path from "node:path";
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

interface KiroMcpConfig {
  mcpServers?: Record<string, unknown>;
}

const stringMapSchema = z.record(z.string(), z.string());
const kiroEntrySchema = z.object({
  type: z.string().optional(),
  url: z.string().min(1).optional(),
  headers: stringMapSchema.optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: stringMapSchema.optional(),
  cwd: z.string().min(1).optional(),
  disabled: z.boolean().optional()
}).passthrough();

// Kiro MCP config at ~/.kiro/settings/mcp.json. The `type` field is optional (omitted
// for simple HTTP servers where Kiro auto-detects transport from the `url` field; set to
// "http" for OAuth servers, "stdio" for local servers). Kiro supports `type:
// "streamable-http"` for remote streamable HTTP servers in mcpServers entries. Sync
// omits `type` for managed entries so Kiro auto-detects the gateway's streamable-http
// transport, matching the documented pattern for simple HTTP servers.
export class KiroAdapter implements ClientAdapter {
  readonly id = "kiro" as const;

  detectConfigPath(): string | null {
    return path.join(homeDir(), ".kiro", "settings", "mcp.json");
  }

  supportsHttp(): boolean {
    return true;
  }

  syncPlugins(plugins: PluginSyncInput[]): PluginSyncResult {
    return syncPluginsToClient(this.id, plugins);
  }

  scanForImports(_config: McpxConfig, managedIndex: ManagedIndex) {
    const configPath = this.detectConfigPath();
    const result = emptyImportScan(this.id, configPath ?? undefined);
    if (!configPath) {
      return result;
    }

    const raw = readJsonFile<KiroMcpConfig>(configPath, {});
    const servers = {
      ...(raw.mcpServers ?? {})
    };

    for (const [name, rawEntry] of Object.entries(servers)) {
      if (isManagedGatewayProjection(name) || managedIndex.managed[this.id]?.entries?.[name]) {
        continue;
      }

      const parsed = kiroEntrySchema.safeParse(rawEntry);
      if (!parsed.success) {
        result.skipped.push(buildImportSkip(this.id, name, "Entry could not be mapped to an mcpx server.", configPath));
        continue;
      }

      const entry = parsed.data;
      if ((entry.type === undefined || entry.type === "http" || entry.type === "streamable-http" || entry.type === "sse") && entry.url && !entry.command) {
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
      return errorResult(this.id, undefined, "Unable to resolve Kiro MCP config path.");
    }

    try {
      const raw = readJsonFile<KiroMcpConfig>(configPath, {});
      const servers = {
        ...(raw.mcpServers ?? {})
      };
      removeSourceEntries(servers, options.sourceEntriesToRemove);
      const managedNames = options.managedEntries.map((entry) => entry.name);
      const enabledEntries = options.managedEntries.filter((entry) => entry.enabled);
      const enabledManagedNames = enabledEntries.map((entry) => entry.name);
      const serverEntries = Object.fromEntries(
        enabledEntries.map((entry) => [entry.name, {
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

      const next: KiroMcpConfig = {
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

  syncSkills(skills: Skill[]): void {
    projectSkillsToDir(path.join(homeDir(), ".kiro", "skills"), skills, "flat");
  }
}
