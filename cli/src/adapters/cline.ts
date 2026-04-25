import os from "node:os";
import { homeDir } from "../core/paths.js";
import path from "node:path";
import fs from "node:fs";
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

interface ClineConfig {
  mcpServers?: Record<string, unknown>;
}

const stringMapSchema = z.record(z.string(), z.string());
const clineEntrySchema = z.object({
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
  return [
    path.join(homeDir(), "Library", "Application Support", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"),
    path.join(homeDir(), "Library", "Application Support", "Cursor", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json")
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
      if ((entry.transportType === undefined || entry.transportType === "http") && entry.url && !entry.command) {
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

      if ((entry.transportType === undefined || entry.transportType === "stdio") && entry.command && !entry.url) {
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

    try {
      const raw = readJsonFile<ClineConfig>(configPath, {});
      const servers = {
        ...(raw.mcpServers ?? {})
      };
      removeSourceEntries(servers, options.sourceEntriesToRemove);
      const managedNames = options.managedEntries.map((entry) => entry.name);
      const serverEntries = Object.fromEntries(
        options.managedEntries.map((entry) => [entry.name, {
          transportType: "http",
          url: entry.url,
          headers: entry.headers,
          disabled: !entry.enabled
        }])
      ) as Record<string, unknown>;
      for (const name of managedNames) {
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

      pruneStaleManagedEntries(options.managedIndex, this.id, servers, managedNames);
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
      return okResult(this.id, configPath);
    } catch (error) {
      return errorResult(this.id, configPath, (error as Error).message);
    }
  }
}
