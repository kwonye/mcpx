import os from "node:os";
import { homeDir } from "../core/paths.js";
import path from "node:path";
import fs from "node:fs";
import { parse, stringify } from "@iarna/toml";
import { z } from "zod";
import type { ClientAdapter, ManagedIndex, McpxConfig, SyncClientOptions, SyncResult } from "../types.js";
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

const stringMapSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  return Object.fromEntries(Object.entries(value));
}, z.record(z.string(), z.string()));
const codexEntrySchema = z.object({
  enabled: z.boolean().optional(),
  url: z.string().min(1).optional(),
  headers: stringMapSchema.optional(),
  http_headers: stringMapSchema.optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: stringMapSchema.optional(),
  cwd: z.string().min(1).optional()
}).passthrough();

export class CodexAdapter implements ClientAdapter {
  readonly id = "codex" as const;

  detectConfigPath(): string | null {
    return path.join(homeDir(), ".codex", "config.toml");
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

    const existing = fs.readFileSync(configPath, "utf8");
    const doc = existing.trim().length > 0 ? (parse(existing) as Record<string, unknown>) : ({} as Record<string, unknown>);
    const mcpServers = ((doc.mcp_servers as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;

    for (const [name, rawEntry] of Object.entries(mcpServers)) {
      if (isManagedGatewayProjection(name) || managedIndex.managed[this.id]?.entries?.[name]) {
        continue;
      }

      const parsed = codexEntrySchema.safeParse(rawEntry);
      if (!parsed.success) {
        result.skipped.push(buildImportSkip(this.id, name, "Entry could not be mapped to an mcpx server.", configPath));
        continue;
      }

      const entry = parsed.data;
      if (entry.url && !entry.command) {
        result.candidates.push({
          clientId: this.id,
          configPath,
          sourceEntryName: name,
          serverName: name,
          spec: {
            transport: "http",
            url: entry.url,
            headers: entry.http_headers ?? entry.headers,
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
      return errorResult(this.id, undefined, "Unable to resolve Codex config.toml path.");
    }

    try {
      const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
      const doc = existing.trim().length > 0 ? (parse(existing) as Record<string, unknown>) : ({} as Record<string, unknown>);

      const mcpServers = ((doc.mcp_servers as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
      removeSourceEntries(mcpServers, options.sourceEntriesToRemove);
      const managedNames = options.managedEntries.map((entry) => entry.name);
      const serverEntries = Object.fromEntries(
        options.managedEntries.map((entry) => [entry.name, {
          enabled: entry.enabled,
          url: entry.url,
          http_headers: entry.headers
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
      fs.writeFileSync(tmpPath, stringify(doc as never), { mode: 0o600 });
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
