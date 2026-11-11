import fs from "node:fs";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "@iarna/toml";
import YAML from "yaml";
import type {
  ClientAdapter,
  ClientImportScanResult,
  ClientInstallation,
  HarnessDescriptor,
  ManagedIndex,
  McpxConfig,
  PluginSyncInput,
  PluginSyncResult,
  Skill,
  SyncClientOptions,
  SyncResult
} from "../types.js";
import { syncProjectPluginSkills } from "../core/plugin-projections.js";
import { projectSkillsToDir } from "../core/skill-projections.js";
import { writeJsonAtomic } from "../util/fs.js";
import { rawEntrySchema, type ClientDefinition, type ConfigFormat } from "./catalogue.js";
import { findOnPath, joinPath, type HostContext } from "./host.js";
import {
  buildImportSkip,
  detectManagedEntryDrift,
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

/** Read a client config document. Missing → {}. Unparseable → throws (never silently overwritten). */
function readDocument(format: ConfigFormat, filePath: string, displayName: string): JsonObject {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const text = fs.readFileSync(filePath, "utf8");
  if (text.trim().length === 0) {
    return {};
  }
  try {
    if (format === "toml") return parseToml(text) as JsonObject;
    if (format === "yaml") return (YAML.parse(text) ?? {}) as JsonObject;
    return JSON.parse(text) as JsonObject;
  } catch (error) {
    throw new Error(`${displayName} config at ${filePath} could not be parsed as ${format.toUpperCase()} (${(error as Error).message}); refusing to overwrite it.`);
  }
}

function writeDocument(format: ConfigFormat, filePath: string, doc: JsonObject): void {
  if (format === "json") {
    writeJsonAtomic(filePath, doc);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, format === "toml" ? stringifyToml(doc as never) : YAML.stringify(doc), { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
}

/** Return the (created-if-missing) object at `keys` inside `doc`. */
function containerOf(doc: JsonObject, keys: string[]): JsonObject {
  let node = doc;
  for (const key of keys) {
    const next = node[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      node[key] = {};
    }
    node = node[key] as JsonObject;
  }
  return node;
}

/** Generic adapter driven entirely by a catalogue definition. */
export class CatalogueAdapter implements ClientAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly descriptor: HarnessDescriptor;

  /**
   * @param projectPath When set, this is the project-scoped installation of the client
   * (config and skills under the project root, id `<client>@<projectPath>`).
   */
  constructor(private readonly def: ClientDefinition, private readonly host: HostContext, readonly projectPath?: string) {
    this.id = projectPath ? `${def.id}@${path.resolve(projectPath)}` : def.id;
    this.displayName = def.displayName;
    this.descriptor = {
      label: def.displayName,
      projectConfig: def.projectConfig,
      projectSkills: def.projectSkills,
      skillLayout: def.skillsLayout,
      pluginComponents: def.pluginComponents
    };
  }

  /** The project-scoped installation of this client, or null when the client has no project config. */
  forProject(projectPath: string): CatalogueAdapter | null {
    return this.def.projectConfig ? new CatalogueAdapter(this.def, this.host, projectPath) : null;
  }

  private configCandidates(): string[] {
    if (this.projectPath && this.def.projectConfig) return [joinPath(this.host, this.projectPath, this.def.projectConfig)];
    return this.def.configPaths(this.host);
  }

  detectConfigPath(): string {
    const candidates = this.configCandidates();
    return candidates.find((candidate) => this.host.exists(candidate)) ?? candidates[0];
  }

  skillDirectory(): string {
    if (this.projectPath) return joinPath(this.host, this.projectPath, this.def.projectSkills ?? `.${this.def.id}/skills`);
    return this.def.skillsDir(this.host);
  }

  additionalSkillDirectories(): string[] {
    return this.projectPath ? [] : this.def.additionalSkillDirs?.(this.host) ?? [];
  }

  managedName(serverName: string): string {
    return this.def.managedName?.(serverName) ?? `${serverName} (mcpx)`;
  }

  detectInstallation(): ClientInstallation {
    if (this.projectPath) {
      const found = [this.detectConfigPath(), this.skillDirectory()].find((marker) => this.host.exists(marker));
      return found ? { installed: true, evidence: found } : { installed: false };
    }
    const markers = [...this.def.configPaths(this.host), ...this.def.installMarkers(this.host)];
    const found = markers.find((marker) => this.host.exists(marker));
    if (found) {
      return { installed: true, evidence: found };
    }
    for (const binary of this.def.binaries) {
      const resolved = findOnPath(this.host, binary);
      if (resolved) {
        return { installed: true, evidence: resolved };
      }
    }
    return { installed: false };
  }

  supportsHttp(): boolean {
    return true;
  }

  syncSkills(skills: Skill[]): void {
    projectSkillsToDir(this.skillDirectory(), skills, this.def.skillsLayout);
  }

  syncPlugins(plugins: PluginSyncInput[]): PluginSyncResult {
    // Plugin skills are projected only into clients that declare them (not e.g. Claude Desktop).
    if (!this.def.pluginComponents?.includes("skills")) {
      return { clientId: this.id, status: "SKIPPED", projectedDirs: [], unsupported: ["skills", "hooks", "agents", "commands"] };
    }
    return syncProjectPluginSkills(this.id, this.skillDirectory(), plugins);
  }

  scanForImports(_config: McpxConfig, managedIndex: ManagedIndex): ClientImportScanResult {
    const configPath = this.detectConfigPath();
    const result = emptyImportScan(this.id, configPath);
    if (!fs.existsSync(configPath)) {
      return result;
    }

    const doc = readDocument(this.def.format, configPath, this.displayName);
    const sources = this.def.importSources?.(doc) ?? containerOf(doc, this.def.container);
    const disabledNames = this.def.disabledNames?.(doc) ?? new Set<string>();

    for (const [name, rawEntry] of Object.entries(sources)) {
      if (isManagedGatewayProjection(name) || managedIndex.managed[this.id]?.entries?.[name]) {
        continue;
      }

      const parsed = rawEntrySchema.safeParse(rawEntry);
      if (!parsed.success) {
        result.skipped.push(buildImportSkip(this.id, name, "Entry could not be mapped to an mcpx server.", configPath));
        continue;
      }

      const spec = this.def.importEntry(parsed.data, disabledNames.has(name));
      if (typeof spec === "string") {
        result.skipped.push(buildImportSkip(this.id, name, spec, configPath));
        continue;
      }
      result.candidates.push({ clientId: this.id, configPath, sourceEntryName: name, serverName: name, spec });
    }

    return result;
  }

  syncGateway(_config: McpxConfig, options: SyncClientOptions): SyncResult {
    const configPath = this.detectConfigPath();
    try {
      const blocked = this.def.syncBlocker?.(configPath, this.host);
      if (blocked) return errorResult(this.id, configPath, blocked);
      const doc = readDocument(this.def.format, configPath, this.displayName);
      const servers = containerOf(doc, this.def.container);
      removeSourceEntries(servers, options.sourceEntriesToRemove);

      const managedEntries = this.def.managedName ? this.renameEntries(options.managedEntries) : options.managedEntries;
      const managedNames = managedEntries.map((entry) => entry.name);
      // Disabled servers are omitted (absent from the client) unless the client has a native enabled flag.
      const written = this.def.keepDisabled ? managedEntries : managedEntries.filter((entry) => entry.enabled);
      const serverEntries = Object.fromEntries(written.map((entry) => [entry.name, this.def.toEntry(entry, this.host)]));
      const writtenNames = Object.keys(serverEntries);

      const driftedNames = writtenNames.filter((name) =>
        detectManagedEntryDrift(options.managedIndex, this.id, name, servers[name])
      );

      for (const name of writtenNames) {
        const conflict = ensureManagedEntryWritable(options.managedIndex, this.id, name, servers[name]);
        if (conflict) {
          return errorResult(this.id, configPath, conflict);
        }
      }

      pruneStaleManagedEntries(options.managedIndex, this.id, servers, writtenNames);
      Object.assign(servers, serverEntries);
      // Global-config reconciliation (e.g. Claude's per-project disabled lists) never runs on a project file.
      if (!this.projectPath) this.def.afterMerge?.(doc, options, managedNames);

      writeDocument(this.def.format, configPath, doc);
      // Fingerprint entries as the client will read them back (TOML/YAML round-trips included).
      const onDisk = containerOf(readDocument(this.def.format, configPath, this.displayName), this.def.container);
      setManagedEntries(
        options.managedIndex,
        this.id,
        configPath,
        Object.fromEntries(Object.entries(serverEntries).map(([name, entry]) => [name, JSON.stringify(entry)])),
        onDisk
      );
      return { ...okResult(this.id, configPath), driftedEntries: driftedNames.length > 0 ? driftedNames : undefined };
    } catch (error) {
      return errorResult(this.id, configPath, (error as Error).message);
    }
  }

  /** Apply the client's native naming; refuse names that collide after normalization. */
  private renameEntries(entries: SyncClientOptions["managedEntries"]): SyncClientOptions["managedEntries"] {
    const seen = new Set<string>();
    return entries.map((entry) => {
      const name = this.managedName(entry.name.replace(/ \(mcpx\)$/, ""));
      const identity = name.replace(/-/g, "_");
      if (seen.has(identity)) {
        throw new Error(`${this.displayName} server names collide after normalization; rename the integrations.`);
      }
      seen.add(identity);
      return { ...entry, name };
    });
  }
}
