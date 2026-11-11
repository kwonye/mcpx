import fs from "node:fs";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "@iarna/toml";
import YAML from "yaml";
import type {
  ClientAdapter,
  ClientImportScanResult,
  ClientInstallation,
  ManagedIndex,
  McpxConfig,
  PluginSyncInput,
  PluginSyncResult,
  Skill,
  SyncClientOptions,
  SyncResult
} from "../types.js";
import { syncPluginsToClient } from "../core/plugin-projections.js";
import { projectSkillsToDir } from "../core/skill-projections.js";
import { writeJsonAtomic } from "../util/fs.js";
import { rawEntrySchema, type ClientDefinition, type ConfigFormat } from "./catalogue.js";
import { findOnPath, type HostContext } from "./host.js";
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
  readonly id;
  readonly displayName: string;

  constructor(private readonly def: ClientDefinition, private readonly host: HostContext) {
    this.id = def.id;
    this.displayName = def.displayName;
  }

  detectConfigPath(): string {
    const candidates = this.def.configPaths(this.host);
    return candidates.find((candidate) => this.host.exists(candidate)) ?? candidates[0];
  }

  detectInstallation(): ClientInstallation {
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
    projectSkillsToDir(this.def.skillsDir(this.host), skills, this.def.skillsLayout);
  }

  syncPlugins(plugins: PluginSyncInput[]): PluginSyncResult {
    return syncPluginsToClient(this.id, plugins);
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
      const doc = readDocument(this.def.format, configPath, this.displayName);
      const servers = containerOf(doc, this.def.container);
      removeSourceEntries(servers, options.sourceEntriesToRemove);

      const managedNames = options.managedEntries.map((entry) => entry.name);
      // Disabled servers are omitted (absent from the client) unless the client has a native enabled flag.
      const written = this.def.keepDisabled ? options.managedEntries : options.managedEntries.filter((entry) => entry.enabled);
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
      this.def.afterMerge?.(doc, options, managedNames);

      writeDocument(this.def.format, configPath, doc);
      setManagedEntries(
        options.managedIndex,
        this.id,
        configPath,
        Object.fromEntries(Object.entries(serverEntries).map(([name, entry]) => [name, JSON.stringify(entry)]))
      );
      return { ...okResult(this.id, configPath), driftedEntries: driftedNames.length > 0 ? driftedNames : undefined };
    } catch (error) {
      return errorResult(this.id, configPath, (error as Error).message);
    }
  }
}
