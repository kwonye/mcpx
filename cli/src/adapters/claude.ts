import os from "node:os";
import { homeDir } from "../core/paths.js";
import path from "node:path";
import { z } from "zod";
import type { ClientAdapter, ManagedIndex, McpxConfig, SyncClientOptions, SyncResult } from "../types.js";
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
  syncDisabledMcpServersArray
} from "./utils/index.js";

type JsonObject = Record<string, unknown>;
const stringMapSchema = z.record(z.string(), z.string());
const claudeEntrySchema = z.object({
  type: z.string().optional(),
  url: z.string().min(1).optional(),
  headers: stringMapSchema.optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: stringMapSchema.optional(),
  cwd: z.string().min(1).optional(),
  disabled: z.boolean().optional()
}).passthrough();

export class ClaudeAdapter implements ClientAdapter {
  readonly id = "claude" as const;

  detectConfigPath(): string | null {
    return path.join(homeDir(), ".claude.json");
  }

  supportsHttp(): boolean {
    return true;
  }

  scanForImports(_config: McpxConfig, managedIndex: ManagedIndex) {
    const configPath = this.detectConfigPath();
    const result = emptyImportScan(this.id, configPath ?? undefined);
    if (!configPath) {
      return result;
    }

    const raw = readJsonFile<JsonObject>(configPath, {});
    const topLevelServers = ((raw.mcpServers as JsonObject | undefined) ?? {}) as JsonObject;
    
    const disabledMcpServers = new Set((raw.disabledMcpServers as string[] | undefined) ?? []);
    const projects = (raw.projects as Record<string, JsonObject> | undefined) ?? {};
    for (const project of Object.values(projects)) {
      const projectDisabled = (project?.disabledMcpServers as string[] | undefined) ?? [];
      for (const name of projectDisabled) {
        disabledMcpServers.add(name);
      }
    }
    
    for (const [name, rawEntry] of Object.entries(topLevelServers)) {
      if (isManagedGatewayProjection(name) || managedIndex.managed[this.id]?.entries?.[name]) {
        continue;
      }

      const parsed = claudeEntrySchema.safeParse(rawEntry);
      if (!parsed.success) {
        result.skipped.push(buildImportSkip(this.id, name, "Entry could not be mapped to an mcpx server.", configPath));
        continue;
      }

      const entry = parsed.data;
      const isDisabled = entry.disabled === true || disabledMcpServers.has(name);
      if ((entry.type === undefined || entry.type === "http") && entry.url && !entry.command) {
        result.candidates.push({
          clientId: this.id,
          configPath,
          sourceEntryName: name,
          serverName: name,
          spec: {
            transport: "http",
            url: entry.url,
            headers: entry.headers,
            enabled: !isDisabled
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
            enabled: !isDisabled
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
      return errorResult(this.id, undefined, "Unable to resolve Claude config path.");
    }

    try {
      const raw = readJsonFile<JsonObject>(configPath, {});
      const managedNames = options.managedEntries.map((entry) => entry.name);
      const serverEntries = Object.fromEntries(
        options.managedEntries.map((entry) => [entry.name, {
          type: "http",
          url: entry.url,
          headers: entry.headers
        }])
      ) as Record<string, unknown>;

      const topLevelServers = ((raw.mcpServers as JsonObject | undefined) ?? {}) as JsonObject;
      removeSourceEntries(topLevelServers, options.sourceEntriesToRemove);
      for (const name of managedNames) {
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

      pruneStaleManagedEntries(options.managedIndex, this.id, topLevelServers, managedNames);
      for (const [name, entry] of Object.entries(serverEntries)) {
        topLevelServers[name] = entry;
      }
      raw.mcpServers = topLevelServers;

      syncDisabledMcpServersArray(raw, managedNames, options.managedEntries);

      const projects = (raw.projects as Record<string, JsonObject> | undefined) ?? {};
      for (const projectPath of Object.keys(projects)) {
        const project = projects[projectPath] ?? {};
        syncDisabledMcpServersArray(project, managedNames, options.managedEntries);
        projects[projectPath] = project;
      }
      raw.projects = projects;

      writeJsonAtomic(configPath, raw);
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
