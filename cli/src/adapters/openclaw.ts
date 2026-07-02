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
const openclawEntrySchema = z.object({
  url: z.string().min(1).optional(),
  transport: z.string().optional(),
  headers: stringMapSchema.optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: stringMapSchema.optional(),
  cwd: z.string().min(1).optional(),
  workingDirectory: z.string().min(1).optional(),
  auth: z.unknown().optional()
}).passthrough();

export class OpenClawAdapter implements ClientAdapter {
  readonly id = "openclaw" as const;

  detectConfigPath(): string | null {
    return process.env.OPENCLAW_CONFIG_PATH ?? path.join(homeDir(), ".openclaw", "openclaw.json");
  }

  supportsHttp(): boolean {
    return true;
  }

  syncPlugins(plugins: PluginSyncInput[]): PluginSyncResult {
    return syncPluginsToClient(this.id, plugins);
  }

  syncSkills(skills: Skill[]): void {
    projectSkillsToDir(path.join(homeDir(), ".openclaw", "skills"), skills, "dir");
  }

  scanForImports(_config: McpxConfig, managedIndex: ManagedIndex) {
    const configPath = this.detectConfigPath();
    const result = emptyImportScan(this.id, configPath ?? undefined);
    if (!configPath) {
      return result;
    }

    let raw: JsonObject;
    try {
      raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch {
      return result;
    }

    const mcpServers: JsonObject = {};
    const rootMcp = raw.mcp as JsonObject | undefined;
    if (rootMcp?.servers) {
      Object.assign(mcpServers, rootMcp.servers as JsonObject);
    }
    if (raw.mcpServers) {
      Object.assign(mcpServers, raw.mcpServers as JsonObject);
    }

    for (const [name, rawEntry] of Object.entries(mcpServers)) {
      if (isManagedGatewayProjection(name) || managedIndex.managed[this.id]?.entries?.[name]) {
        continue;
      }

      const parsed = openclawEntrySchema.safeParse(rawEntry);
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
            cwd: entry.workingDirectory ?? entry.cwd,
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
      return errorResult(this.id, undefined, "Unable to resolve OpenClaw config path.");
    }

    try {
      let raw: JsonObject;
      if (fs.existsSync(configPath)) {
        try {
          raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
        } catch {
          return errorResult(this.id, configPath, "OpenClaw config contains invalid JSON (possibly JSON5). Cannot safely write.");
        }
      } else {
        raw = {};
      }

      const rootMcp = (raw.mcp as JsonObject | undefined) ?? {};
      const servers = (rootMcp.servers as JsonObject | undefined) ?? {};
      removeSourceEntries(servers, options.sourceEntriesToRemove);
      const enabledEntries = options.managedEntries.filter((entry) => entry.enabled);
      const serverEntries = Object.fromEntries(
        enabledEntries.map((entry) => [entry.name, {
          url: entry.url,
          transport: "streamable-http",
          headers: entry.headers
        }])
      ) as Record<string, unknown>;
      const enabledManagedNames = enabledEntries.map((entry) => entry.name);
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

      rootMcp.servers = servers;
      raw.mcp = rootMcp;

      writeJsonAtomic(configPath, raw);
      setManagedEntries(
        options.managedIndex,
        this.id,
        configPath,
        Object.fromEntries(
          options.managedEntries.map((entry) => [
            entry.name,
            JSON.stringify({ url: entry.url, transport: "streamable-http", headers: entry.headers, enabled: entry.enabled })
          ])
        )
      );
      return okResult(this.id, configPath);
    } catch (error) {
      return errorResult(this.id, configPath, (error as Error).message);
    }
  }
}
