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

type JsonObject = Record<string, unknown>;

export class QwenAdapter implements ClientAdapter {
  readonly id = "qwen" as const;

  detectConfigPath(): string | null {
    return path.join(os.homedir(), ".qwen", "settings.json");
  }

  supportsHttp(): boolean {
    return true;
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
