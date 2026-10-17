import os from "node:os";
import fs from "node:fs";
import { homeDir } from "../core/paths.js";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { ClientAdapter, ManagedIndex, McpxConfig, Skill, SyncClientOptions, SyncResult, PluginSyncInput, PluginSyncResult } from "../types.js";
import { syncPluginsToClient } from "../core/plugin-projections.js";
import { projectSkillsToDir } from "../core/skill-projections.js";
import { readJsonFile, writeJsonAtomic } from "../util/fs.js";
import {
  buildImportSkip,
  emptyImportScan,
  ensureManagedEntryWritable,
  errorResult,
  isManagedGatewayProjection,
  okResult,
  pruneStaleManagedEntries,
  removeSourceEntries,
  setManagedEntries,
  purgeManagedFromExcludedArray
} from "./utils/index.js";

type JsonObject = Record<string, unknown>;
const stringMapSchema = z.record(z.string(), z.string());
const hermesEntrySchema = z.object({
  url: z.string().min(1).optional(),
  headers: stringMapSchema.optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: stringMapSchema.optional(),
  auth: z.unknown().optional(),
  enabled: z.boolean().optional(),
  timeout: z.number().optional(),
  tools: z.array(z.string()).optional()
}).passthrough();

export class HermesAdapter implements ClientAdapter {
  readonly id = "hermes" as const;

  detectConfigPath(): string | null {
    return path.join(homeDir(), ".hermes", "config.yaml");
  }

  supportsHttp(): boolean {
    return true;
  }

  syncPlugins(plugins: PluginSyncInput[]): PluginSyncResult {
    return syncPluginsToClient(this.id, plugins);
  }

  syncSkills(skills: Skill[]): void {
    projectSkillsToDir(path.join(homeDir(), ".hermes", "skills"), skills, "dir");
  }

  scanForImports(_config: McpxConfig, managedIndex: ManagedIndex) {
    const configPath = this.detectConfigPath();
    const result = emptyImportScan(this.id, configPath ?? undefined);
    if (!configPath || !fs.existsSync(configPath)) {
      return result;
    }

    const existing = fs.readFileSync(configPath, "utf8");
    const doc = (YAML.parse(existing) ?? {}) as JsonObject;
    const mcpServers = ((doc.mcp_servers as JsonObject | undefined) ?? {}) as JsonObject;

    for (const [name, rawEntry] of Object.entries(mcpServers)) {
      if (isManagedGatewayProjection(name) || managedIndex.managed[this.id]?.entries?.[name]) {
        continue;
      }

      const parsed = hermesEntrySchema.safeParse(rawEntry);
      if (!parsed.success) {
        result.skipped.push(buildImportSkip(this.id, name, "Entry could not be mapped to an mcpx server.", configPath));
        continue;
      }

      const entry = parsed.data;
      if (entry.auth === "oauth") {
        result.skipped.push(buildImportSkip(this.id, name, "OAuth-authenticated servers cannot be imported via mcpx.", configPath));
        continue;
      }

      if (entry.url && !entry.command) {
        result.candidates.push({
          clientId: this.id,
          configPath,
          sourceEntryName: name,
          serverName: name,
          spec: {
            transport: "http",
            url: entry.url,
            headers: entry.headers,
            enabled: entry.enabled !== false
          }
        });
        continue;
      }

      if (entry.command && !entry.url) {
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
            enabled: entry.enabled !== false
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
      return errorResult(this.id, undefined, "Unable to resolve Hermes config.yaml path.");
    }

    try {
      const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
      const doc = existing.trim().length > 0 ? (YAML.parse(existing) ?? {}) : {};
      const mcpServers = ((doc.mcp_servers as JsonObject | undefined) ?? {}) as JsonObject;

      removeSourceEntries(mcpServers, options.sourceEntriesToRemove);
      const managedNames = options.managedEntries.map((entry) => entry.name);
      const serverEntries = Object.fromEntries(
        options.managedEntries.map((entry) => [entry.name, {
          url: entry.url,
          headers: entry.headers,
          enabled: entry.enabled
        }])
      ) as Record<string, unknown>;

      for (const name of managedNames) {
        const conflict = ensureManagedEntryWritable(
          options.managedIndex,
          this.id,
          name,
          mcpServers[name]
        );
        if (conflict) {
          return errorResult(this.id, configPath, conflict);
        }
      }

      pruneStaleManagedEntries(options.managedIndex, this.id, mcpServers, managedNames);
      for (const [name, entry] of Object.entries(serverEntries)) {
        mcpServers[name] = entry;
      }

      doc.mcp_servers = mcpServers;

      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      const tmpPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
      fs.writeFileSync(tmpPath, YAML.stringify(doc), { mode: 0o600 });
      fs.renameSync(tmpPath, configPath);

      setManagedEntries(
        options.managedIndex,
        this.id,
        configPath,
        Object.fromEntries(Object.entries(serverEntries).map(([name, entry]) => [name, JSON.stringify(entry)]))
      );
      return okResult(this.id, configPath);
    } catch (error) {
      return errorResult(this.id, configPath, (error as Error).message);
    }
  }
}
