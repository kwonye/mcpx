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
  setManagedEntries
} from "./utils/index.js";

interface OpenCodeConfig {
  mcp?: Record<string, unknown>;
}

const stringMapSchema = z.record(z.string(), z.string());
const openCodeEntrySchema = z.object({
  type: z.string().optional(),
  url: z.string().min(1).optional(),
  headers: stringMapSchema.optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: stringMapSchema.optional(),
  cwd: z.string().min(1).optional(),
  enabled: z.boolean().optional()
}).passthrough();

export class OpenCodeAdapter implements ClientAdapter {
  readonly id = "opencode" as const;

  detectConfigPath(): string | null {
    return path.join(homeDir(), ".config", "opencode", "opencode.json");
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

    const raw = readJsonFile<OpenCodeConfig>(configPath, {});
    const mcp = {
      ...(raw.mcp ?? {})
    };

    for (const [name, rawEntry] of Object.entries(mcp)) {
      if (isManagedGatewayProjection(name) || managedIndex.managed[this.id]?.entries?.[name]) {
        continue;
      }

      const parsed = openCodeEntrySchema.safeParse(rawEntry);
      if (!parsed.success) {
        result.skipped.push(buildImportSkip(this.id, name, "Entry could not be mapped to an mcpx server.", configPath));
        continue;
      }

      const entry = parsed.data;
      if ((entry.type === undefined || entry.type === "remote" || entry.type === "http") && entry.url && !entry.command) {
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
      return errorResult(this.id, undefined, "Unable to resolve OpenCode config path.");
    }

    try {
      const raw = readJsonFile<OpenCodeConfig>(configPath, {});
      const mcp = {
        ...(raw.mcp ?? {})
      };
      removeSourceEntries(mcp, options.sourceEntriesToRemove);
      const managedNames = options.managedEntries.map((entry) => entry.name);
      const serverEntries = Object.fromEntries(
        options.managedEntries.map((entry) => [entry.name, {
          type: "remote",
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
          mcp[name]
        );
        if (conflict) {
          return errorResult(this.id, configPath, conflict);
        }
      }

      pruneStaleManagedEntries(options.managedIndex, this.id, mcp, managedNames);
      for (const [name, entry] of Object.entries(serverEntries)) {
        mcp[name] = entry;
      }

      const next: OpenCodeConfig = {
        ...raw,
        mcp
      };

      writeJsonAtomic(configPath, next);
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
