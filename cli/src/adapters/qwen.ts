import os from "node:os";
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
  setManagedEntries
} from "./utils/index.js";

type JsonObject = Record<string, unknown>;
const stringMapSchema = z.record(z.string(), z.string());
const qwenEntrySchema = z.object({
  httpUrl: z.string().min(1).optional(),
  headers: stringMapSchema.optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: stringMapSchema.optional(),
  cwd: z.string().min(1).optional(),
  disabled: z.boolean().optional()
}).passthrough();

export class QwenAdapter implements ClientAdapter {
  readonly id = "qwen" as const;

  detectConfigPath(): string | null {
    return path.join(os.homedir(), ".qwen", "settings.json");
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
    for (const [name, rawEntry] of Object.entries(topLevelServers)) {
      if (isManagedGatewayProjection(name) || managedIndex.managed[this.id]?.entries?.[name]) {
        continue;
      }

      const parsed = qwenEntrySchema.safeParse(rawEntry);
      if (!parsed.success) {
        result.skipped.push(buildImportSkip(this.id, name, "Entry could not be mapped to an mcpx server.", configPath));
        continue;
      }

      const entry = parsed.data;
      if (entry.disabled) {
        result.skipped.push(buildImportSkip(this.id, name, "Entry is disabled in Qwen config.", configPath));
        continue;
      }

      if (entry.httpUrl && !entry.command) {
        result.candidates.push({
          clientId: this.id,
          configPath,
          sourceEntryName: name,
          serverName: name,
          spec: {
            transport: "http",
            url: entry.httpUrl,
            headers: entry.headers
          }
        });
        continue;
      }

      if (entry.command && !entry.httpUrl) {
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
            cwd: entry.cwd
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
      return errorResult(this.id, undefined, "Unable to resolve Qwen config path.");
    }

    try {
      const raw = readJsonFile<JsonObject>(configPath, {});
      const managedNames = options.managedEntries.map((entry) => entry.name);
      const serverEntries = Object.fromEntries(
        options.managedEntries.map((entry) => [entry.name, {
          httpUrl: entry.url,
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
