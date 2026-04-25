import { execFileSync } from "node:child_process";
import { homeDir } from "../core/paths.js";
import path from "node:path";
import { z } from "zod";
import type { ClientAdapter, ManagedIndex, ManagedGatewayEntry, McpxConfig, SyncClientOptions, SyncResult } from "../types.js";
import { readJsonFile, writeJsonAtomic } from "../util/fs.js";
import { APP_VERSION } from "../version.js";
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

function buildProxyEntry(entry: ManagedGatewayEntry): { command: string; args: string[] } {
  const upstreamName = entry.name.replace(/ \(mcpx\)$/, "");
  try {
    const mcpxPath = execFileSync("which", ["mcpx"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (mcpxPath) return { command: mcpxPath, args: ["proxy", upstreamName] };
  } catch {}
  return { command: "npx", args: ["-y", `@kwonye/mcpx@${APP_VERSION}`, "proxy", upstreamName] };
}

export class ClaudeDesktopAdapter implements ClientAdapter {
  readonly id = "claude-desktop" as const;

  detectConfigPath(): string | null {
    return path.join(homeDir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
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

      const parsed = claudeDesktopEntrySchema.safeParse(rawEntry);
      if (!parsed.success) {
        result.skipped.push(buildImportSkip(this.id, name, "Entry could not be mapped to an mcpx server.", configPath));
        continue;
      }

      const entry = parsed.data;
      if ((entry.type === undefined || entry.type === "http" || entry.type === "streamable_http") && entry.url && !entry.command) {
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
          const { command, args } = buildProxyEntry(entry);
          return [entry.name, { command, args }];
        })
      ) as Record<string, unknown>;
      const enabledManagedNames = enabledEntries.map((entry) => entry.name);

      const topLevelServers = ((raw.mcpServers as JsonObject | undefined) ?? {}) as JsonObject;
      removeSourceEntries(topLevelServers, options.sourceEntriesToRemove);
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
          options.managedEntries.map((entry) => {
            const { command, args } = buildProxyEntry(entry);
            return [entry.name, JSON.stringify({ command, args, enabled: entry.enabled })];
          })
        )
      );
      return okResult(this.id, configPath);
    } catch (error) {
      return errorResult(this.id, configPath, (error as Error).message);
    }
  }
}
