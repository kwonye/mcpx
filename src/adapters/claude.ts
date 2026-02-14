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

type JsonObject = Record<string, unknown>;

export class ClaudeAdapter implements ClientAdapter {
  readonly id = "claude" as const;

  detectConfigPath(): string | null {
    return path.join(os.homedir(), ".claude.json");
  }

  supportsHttp(): boolean {
    return true;
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

      if (raw.projects && typeof raw.projects === "object") {
        const projects = raw.projects as Record<string, unknown>;

        for (const [projectPath, projectValue] of Object.entries(projects)) {
          if (!projectValue || typeof projectValue !== "object") {
            continue;
          }

          const project = projectValue as JsonObject;
          const projectServers = ((project.mcpServers as JsonObject | undefined) ?? {}) as JsonObject;
          for (const name of managedNames) {
            const projectConflict = ensureManagedEntryWritable(
              options.managedIndex,
              this.id,
              name,
              projectServers[name]
            );
            if (projectConflict) {
              return errorResult(this.id, configPath, `${projectConflict} (project: ${projectPath})`);
            }
          }

          pruneStaleManagedEntries(options.managedIndex, this.id, projectServers, managedNames);
          for (const [name, entry] of Object.entries(serverEntries)) {
            projectServers[name] = entry;
          }
          project.mcpServers = projectServers;
          projects[projectPath] = project;
        }
      }

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
