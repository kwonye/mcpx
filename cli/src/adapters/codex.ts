import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { parse, stringify } from "@iarna/toml";
import type { ClientAdapter, McpxConfig, SyncClientOptions, SyncResult } from "../types.js";
import {
  ensureManagedEntryWritable,
  errorResult,
  okResult,
  pruneStaleManagedEntries,
  setManagedEntries
} from "./utils/index.js";

export class CodexAdapter implements ClientAdapter {
  readonly id = "codex" as const;

  detectConfigPath(): string | null {
    return path.join(os.homedir(), ".codex", "config.toml");
  }

  supportsHttp(): boolean {
    return true;
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
      const managedNames = options.managedEntries.map((entry) => entry.name);
      const serverEntries = Object.fromEntries(
        options.managedEntries.map((entry) => [entry.name, {
          enabled: true,
          url: entry.url,
          headers: entry.headers
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
