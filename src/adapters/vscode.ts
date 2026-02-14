import os from "node:os";
import path from "node:path";
import type { ClientAdapter, McpxConfig, SyncClientOptions, SyncResult } from "../types.js";
import { readJsonFile, writeJsonAtomic } from "../util/fs.js";
import {
  ensureManagedEntryWritable,
  errorResult,
  okResult,
  pruneStaleManagedEntries,
  setManagedEntries
} from "./utils.js";

interface VsCodeMcpConfig {
  servers?: Record<string, unknown>;
}

export class VsCodeAdapter implements ClientAdapter {
  readonly id = "vscode" as const;

  detectConfigPath(): string | null {
    return path.join(os.homedir(), "Library", "Application Support", "Code", "User", "mcp.json");
  }

  supportsHttp(): boolean {
    return true;
  }

  syncGateway(_config: McpxConfig, options: SyncClientOptions): SyncResult {
    const configPath = this.detectConfigPath();
    if (!configPath) {
      return errorResult(this.id, undefined, "Unable to resolve VS Code MCP config path.");
    }

    try {
      const raw = readJsonFile<VsCodeMcpConfig>(configPath, {});
      const servers = {
        ...(raw.servers ?? {})
      };
      const managedNames = options.managedEntries.map((entry) => entry.name);
      const serverEntries = Object.fromEntries(
        options.managedEntries.map((entry) => [entry.name, {
          type: "http",
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

      const next: VsCodeMcpConfig = {
        ...raw,
        servers
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
