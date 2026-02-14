import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { ClientAdapter, McpxConfig, SyncClientOptions, SyncResult } from "../types.js";
import { readJsonFile, writeJsonAtomic } from "../util/fs.js";
import {
  ensureManagedEntryWritable,
  errorResult,
  okResult,
  pruneStaleManagedEntries,
  setManagedEntries
} from "./utils.js";

interface ClineConfig {
  mcpServers?: Record<string, unknown>;
}

function getCandidatePaths(): string[] {
  return [
    path.join(os.homedir(), "Library", "Application Support", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"),
    path.join(os.homedir(), "Library", "Application Support", "Cursor", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json")
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
      const managedNames = options.managedEntries.map((entry) => entry.name);
      const serverEntries = Object.fromEntries(
        options.managedEntries.map((entry) => [entry.name, {
          transportType: "http",
          url: entry.url,
          headers: entry.headers
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
