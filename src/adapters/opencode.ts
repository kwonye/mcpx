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
} from "./utils/index.js";

interface OpenCodeConfig {
  mcp?: Record<string, unknown>;
}

export class OpenCodeAdapter implements ClientAdapter {
  readonly id = "opencode" as const;

  detectConfigPath(): string | null {
    return path.join(os.homedir(), ".config", "opencode", "opencode.json");
  }

  supportsHttp(): boolean {
    return true;
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
      const managedNames = options.managedEntries.map((entry) => entry.name);
      const serverEntries = Object.fromEntries(
        options.managedEntries.map((entry) => [entry.name, {
          type: "remote",
          url: entry.url,
          headers: entry.headers,
          enabled: true
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
