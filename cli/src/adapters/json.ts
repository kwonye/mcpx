import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { homeDir } from "../core/paths.js";
import { projectSkillsToDir } from "../core/skill-projections.js";
import { syncPluginsToClient } from "../core/plugin-projections.js";
import { writeJsonAtomic } from "../util/fs.js";
import type { ClientAdapter, ManagedIndex, McpxConfig, SyncClientOptions, SyncResult, Skill, PluginSyncInput } from "../types.js";
import { emptyImportScan, buildImportSkip, ensureManagedEntryWritable, pruneStaleManagedEntries, removeSourceEntries, setManagedEntries } from "./utils/index.js";

const entrySchema = z.object({
  type: z.string().optional(), url: z.string().optional(), command: z.union([z.string(), z.array(z.string())]).optional(),
  args: z.array(z.string()).optional(), cwd: z.string().optional(), env: z.record(z.string(), z.string()).optional(),
  environment: z.record(z.string(), z.string()).optional(), headers: z.record(z.string(), z.string()).optional(), enabled: z.boolean().optional(),
}).passthrough();
export function readNativeJson(file: string): Record<string, any> {
  if (!fs.existsSync(file)) return {};
  try { return z.record(z.string(), z.unknown()).parse(JSON.parse(fs.readFileSync(file, "utf8"))); }
  catch { throw new Error(`Native configuration is invalid JSON: ${file}`); }
}
export interface JsonHarnessOptions {
  id: string;
  configPath: () => string;
  skillsPath: () => string;
  format?: "opencode" | "standard";
}

/** Shared codec; a new JSON harness supplies paths and its native format. */
export class JsonHarnessAdapter implements ClientAdapter {
  readonly id: string;
  constructor(readonly options: JsonHarnessOptions) { this.id = options.id; }
  detectConfigPath() { return this.options.configPath(); }
  supportsHttp() { return true; }
  skillDirectory() { return this.options.skillsPath(); }
  syncSkills(skills: Skill[]) { projectSkillsToDir(this.skillDirectory(), skills, "dir"); }
  syncPlugins(plugins: PluginSyncInput[]) { return syncPluginsToClient(this.id, plugins); }
  private get key() { return this.options.format === "opencode" ? "mcp" : "mcpServers"; }
  scanForImports(_config: McpxConfig, index: ManagedIndex) {
    const configPath = this.detectConfigPath();
    const result = emptyImportScan(this.id, configPath);
    const entries = readNativeJson(configPath)[this.key] ?? {};
    for (const [name, value] of Object.entries(entries)) {
      if (index.managed[this.id]?.entries[name]) continue;
      const parsed = entrySchema.safeParse(value);
      if (!parsed.success) { result.skipped.push(buildImportSkip(this.id, name, "Unsupported MCP configuration", configPath)); continue; }
      const entry = parsed.data;
      if (entry.url && !entry.command && [undefined, "http", "remote", "streamable-http"].includes(entry.type)) {
        result.candidates.push({ clientId: this.id, configPath, sourceEntryName: name, serverName: name, spec: { transport: "http", url: entry.url, headers: entry.headers, enabled: entry.enabled !== false } });
      } else if (entry.command && !entry.url && [undefined, "local", "stdio"].includes(entry.type)) {
        const command = Array.isArray(entry.command) ? entry.command[0] : entry.command;
        const args = Array.isArray(entry.command) ? entry.command.slice(1) : entry.args;
        if (command) result.candidates.push({ clientId: this.id, configPath, sourceEntryName: name, serverName: name, spec: { transport: "stdio", command, args, env: entry.env ?? entry.environment, cwd: entry.cwd, enabled: entry.enabled !== false } });
      } else result.skipped.push(buildImportSkip(this.id, name, "Requires an unambiguous stdio or HTTP transport", configPath));
    }
    return result;
  }
  syncGateway(_config: McpxConfig, options: SyncClientOptions): SyncResult {
    const configPath = this.detectConfigPath();
    try {
      const raw = readNativeJson(configPath);
      const servers = { ...(raw[this.key] ?? {}) };
      const entries = Object.fromEntries(options.managedEntries.filter(e => e.enabled).map(e => [e.name, { type: this.options.format === "opencode" ? "remote" : "http", url: e.url, headers: e.headers }]));
      for (const name of Object.keys(entries)) {
        const conflict = ensureManagedEntryWritable(options.managedIndex, this.id, name, servers[name]);
        if (conflict) throw new Error(conflict);
      }
      pruneStaleManagedEntries(options.managedIndex, this.id, servers, Object.keys(entries));
      removeSourceEntries(servers, options.sourceEntriesToRemove);
      Object.assign(servers, entries);
      writeJsonAtomic(configPath, { ...raw, [this.key]: servers });
      setManagedEntries(options.managedIndex, this.id, configPath, Object.fromEntries(Object.entries(entries).map(([name, entry]) => [name, JSON.stringify(entry)])));
      return { clientId: this.id, configPath, status: "SYNCED" };
    } catch (error) { return { clientId: this.id, configPath, status: "ERROR", message: (error as Error).message }; }
  }
}

export class OpenCodeAdapter extends JsonHarnessAdapter {
  constructor() { super({ id: "opencode", configPath: () => path.join(homeDir(), ".config", "opencode", "opencode.json"), skillsPath: () => path.join(homeDir(), ".config", "opencode", "skills"), format: "opencode" }); }
}
