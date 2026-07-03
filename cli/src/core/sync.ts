import type {
  ClientAdapter,
  ClientId,
  ClientStatus,
  ManagedGatewayEntry,
  McpxConfig,
  PluginSyncInput,
  PluginSyncResult,
  ProjectScope,
  SyncImportReport,
  SyncResult,
} from "../types.js";
import { isServerEnabled } from "../types.js";
import { managedGatewayEntryName } from "../adapters/utils/index.js";
import { getAdapters } from "../adapters/index.js";
import { serverSpecsEqual } from "../adapters/utils/index.js";
import { loadManagedIndex, saveManagedIndex } from "./managed-index.js";
import { getManagedIndexPath } from "./paths.js";
import { ensureGatewayToken } from "./registry.js";
import { SecretsManager } from "./secrets.js";
import { listSkills } from "./skills.js";
import { withManagedIndexLock } from "./managed-index-lock.js";

export interface SyncOptions {
  targetClients?: ClientId[];
  importScan?: boolean;
}

export interface SyncSummary {
  gatewayUrl: string;
  imports: SyncImportReport;
  results: SyncResult[];
  hasErrors: boolean;
  clientStates?: Record<string, { status: ClientStatus; configPath?: string; message?: string; lastSyncAt: string }>;
  phaseErrors?: Array<{ clientId: ClientId; phase: string; message: string }>;
  pluginResults?: PluginSyncResult[];
}

export function getGatewayUrl(config: McpxConfig): string {
  return `http://127.0.0.1:${config.gateway.port}/mcp`;
}

function buildProjectScopes(config: McpxConfig): ProjectScope[] {
  const globallyEnabled = new Set(
    Object.entries(config.servers)
      .filter(([, spec]) => isServerEnabled(spec))
      .map(([name]) => name)
  );

  // Build a map of project path → set of plugin server names disabled for that project
  const pluginDisabledByProject = new Map<string, Set<string>>();
  for (const [, plugin] of Object.entries(config.plugins ?? {})) {
    if (!plugin.projectOverrides) continue;
    for (const [overridePath, override] of Object.entries(plugin.projectOverrides)) {
      const disabled = override.enabled === false || override.components?.mcpServers === false;
      if (!disabled) continue;
      if (!pluginDisabledByProject.has(overridePath)) {
        pluginDisabledByProject.set(overridePath, new Set());
      }
      for (const serverName of plugin.serverNames) {
        pluginDisabledByProject.get(overridePath)!.add(managedGatewayEntryName(serverName));
      }
    }
  }

  return Object.values(config.projects ?? {}).map((project) => {
    const projectPath = project.path;
    const disabledServerNames = (project.disabledServers ?? [])
      .filter((name) => globallyEnabled.has(name))
      .map((name) => managedGatewayEntryName(name));

    const pluginDisabled = pluginDisabledByProject.get(projectPath);
    if (pluginDisabled) {
      for (const name of pluginDisabled) {
        if (!disabledServerNames.includes(name)) {
          disabledServerNames.push(name);
        }
      }
    }

    return { path: projectPath, disabledServerNames };
  });
}

function buildManagedEntries(config: McpxConfig, gatewayUrl: string, localToken: string): ManagedGatewayEntry[] {
  return Object.entries(config.servers).map(([name, spec]) => ({
    name: `${name} (mcpx)`,
    url: `${gatewayUrl}?upstream=${encodeURIComponent(name)}`,
    headers: { Authorization: `Bearer ${localToken}` },
    enabled: isServerEnabled(spec),
  }));
}

function isClientInternalServerCommand(candidate: { spec: { transport: string; command?: string } }): boolean {
  return candidate.spec.transport === "stdio" && /\.app\/Contents\//.test(candidate.spec.command ?? "");
}

function getFilteredAdapters(targetClients?: ClientId[]): ClientAdapter[] {
  const adapters = getAdapters();
  if (targetClients && targetClients.length > 0) {
    return adapters.filter((a) => targetClients!.includes(a.id));
  }
  return adapters;
}

function runImportPhase(
  adapters: ClientAdapter[],
  config: McpxConfig,
  managedIndex: ReturnType<typeof loadManagedIndex>,
): { imports: SyncImportReport; sourceEntriesToRemove: Map<ClientId, Set<string>>; phaseErrors: SyncSummary["phaseErrors"] } {
  const imports: SyncImportReport = { imported: [], duplicates: [], skipped: [], conflicts: [], errors: [] };
  const sourceEntriesToRemove = new Map<ClientId, Set<string>>();
  const phaseErrors: SyncSummary["phaseErrors"] = [];

  for (const adapter of adapters) {
    try {
      const scan = adapter.scanForImports(config, managedIndex);
      imports.skipped.push(...scan.skipped);

      for (const candidate of scan.candidates) {
        if (isClientInternalServerCommand(candidate)) {
          imports.skipped.push({
            clientId: candidate.clientId,
            configPath: candidate.configPath,
            sourceEntryName: candidate.sourceEntryName,
            serverName: candidate.serverName,
            reason: "client-internal server",
          });
          continue;
        }

        const existing = config.servers[candidate.serverName];
        if (!existing) {
          config.servers[candidate.serverName] = candidate.spec;
          imports.imported.push({
            clientId: candidate.clientId,
            configPath: candidate.configPath,
            sourceEntryName: candidate.sourceEntryName,
            serverName: candidate.serverName,
          });
          if (!sourceEntriesToRemove.has(candidate.clientId)) {
            sourceEntriesToRemove.set(candidate.clientId, new Set<string>());
          }
          sourceEntriesToRemove.get(candidate.clientId)!.add(candidate.sourceEntryName);
          continue;
        }

        if (serverSpecsEqual(existing, candidate.spec)) {
          imports.duplicates.push({
            clientId: candidate.clientId,
            configPath: candidate.configPath,
            sourceEntryName: candidate.sourceEntryName,
            serverName: candidate.serverName,
          });
          if (!sourceEntriesToRemove.has(candidate.clientId)) {
            sourceEntriesToRemove.set(candidate.clientId, new Set<string>());
          }
          sourceEntriesToRemove.get(candidate.clientId)!.add(candidate.sourceEntryName);
          continue;
        }

        imports.conflicts.push({
          clientId: candidate.clientId,
          configPath: candidate.configPath,
          sourceEntryName: candidate.sourceEntryName,
          serverName: candidate.serverName,
          message: `Server "${candidate.serverName}" already exists in mcpx with a different configuration.`,
        });
      }
    } catch (error) {
      imports.errors.push({
        clientId: adapter.id,
        configPath: adapter.detectConfigPath() ?? undefined,
        message: error instanceof Error ? error.message : String(error),
      });
      phaseErrors.push({
        clientId: adapter.id,
        phase: "import",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imports, sourceEntriesToRemove, phaseErrors };
}

function runSkillsPhase(adapters: ClientAdapter[], skills: ReturnType<typeof listSkills>): SyncSummary["phaseErrors"] {
  const phaseErrors: SyncSummary["phaseErrors"] = [];
  for (const adapter of adapters) {
    if (adapter.syncSkills) {
      try {
        adapter.syncSkills(skills);
      } catch (error) {
        phaseErrors.push({
          clientId: adapter.id,
          phase: "skills",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return phaseErrors;
}

function runPluginsPhase(
  adapters: ClientAdapter[],
  pluginInputs: PluginSyncInput[],
): { pluginResults: PluginSyncResult[]; phaseErrors: SyncSummary["phaseErrors"] } {
  const pluginResults: PluginSyncResult[] = [];
  const phaseErrors: SyncSummary["phaseErrors"] = [];

  for (const adapter of adapters) {
    if (adapter.syncPlugins) {
      try {
        const result = adapter.syncPlugins(pluginInputs);
        if (result) pluginResults.push(result);
      } catch (error) {
        phaseErrors.push({
          clientId: adapter.id,
          phase: "plugins",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return { pluginResults, phaseErrors };
}

function runGatewayPhase(
  adapters: ClientAdapter[],
  config: McpxConfig,
  managedEntries: ManagedGatewayEntry[],
  managedIndex: ReturnType<typeof loadManagedIndex>,
  managedIndexPath: string,
  sourceEntriesToRemove: Map<ClientId, Set<string>>,
  projectScopes: ProjectScope[],
): { results: SyncResult[]; phaseErrors: SyncSummary["phaseErrors"] } {
  const results: SyncResult[] = [];
  const phaseErrors: SyncSummary["phaseErrors"] = [];

  for (const adapter of adapters) {
    if (!adapter.supportsHttp()) {
      results.push({
        clientId: adapter.id,
        status: "UNSUPPORTED_HTTP",
        message: "Client adapter does not support MCP over HTTP.",
      });
      continue;
    }

    try {
      const result = adapter.syncGateway(config, {
        managedEntries,
        managedIndex,
        managedIndexPath,
        sourceEntriesToRemove: Array.from(sourceEntriesToRemove.get(adapter.id) ?? []),
        projectScopes,
      });
      results.push(result);
    } catch (error) {
      results.push({
        clientId: adapter.id,
        status: "ERROR",
        message: error instanceof Error ? error.message : String(error),
      });
      phaseErrors.push({
        clientId: adapter.id,
        phase: "gateway",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { results, phaseErrors };
}

export function syncAllClients(
  config: McpxConfig,
  secrets: SecretsManager,
  options?: SyncOptions | ClientId[],
): SyncSummary {
  // Backward compat: accept ClientId[] or undefined as third argument
  const opts: SyncOptions = Array.isArray(options)
    ? { targetClients: options, importScan: false }
    : { importScan: false, ...options };
  const managedIndexPath = getManagedIndexPath();
  return withManagedIndexLock(`${managedIndexPath}.lock`, () => {
    const managedIndex = loadManagedIndex(managedIndexPath);
    const adapters = getFilteredAdapters(opts.targetClients);
    const allPhaseErrors: SyncSummary["phaseErrors"] = [];

    // Phase 1: Import (optional, gated by importScan option)
    let imports: SyncImportReport = { imported: [], duplicates: [], skipped: [], conflicts: [], errors: [] };
    let sourceEntriesToRemove = new Map<ClientId, Set<string>>();
    if (opts.importScan) {
      const importResult = runImportPhase(adapters, config, managedIndex);
      imports = importResult.imports;
      sourceEntriesToRemove = importResult.sourceEntriesToRemove;
      allPhaseErrors.push(...(importResult.phaseErrors ?? []));
    }

    // Phase 2: Gateway entries
    const localToken = ensureGatewayToken(config, secrets);
    const gatewayUrl = getGatewayUrl(config);
    const managedEntries = buildManagedEntries(config, gatewayUrl, localToken);

    const gatewayResult = runGatewayPhase(
      adapters, config, managedEntries, managedIndex, managedIndexPath,
      sourceEntriesToRemove, buildProjectScopes(config),
    );
    const results = gatewayResult.results;
    allPhaseErrors.push(...(gatewayResult.phaseErrors ?? []));

    // Phase 3: Skills
    const skills = listSkills();
    const skillsErrors = runSkillsPhase(adapters, skills);
    allPhaseErrors.push(...(skillsErrors ?? []));

    // Phase 4: Plugins (always dispatched, even with zero inputs — handles pruning)
    const pluginInputs: PluginSyncInput[] = Object.values(config.plugins ?? {}).map((p) => ({
      pluginId: p.id,
      pluginName: p.name,
      pluginRoot: p.root,
      components: p.components,
      approvals: p.approvals ?? {},
      enabled: p.enabled,
      serverNames: p.serverNames,
      skills: p.discovered.skills,
      commands: p.discovered.commands,
      agents: p.discovered.agents,
      hooks: p.discovered.hooks,
    }));
    const pluginResult = runPluginsPhase(adapters, pluginInputs);
    const pluginResults = pluginResult.pluginResults;
    allPhaseErrors.push(...(pluginResult.phaseErrors ?? []));

    saveManagedIndex(managedIndex, managedIndexPath);

    const clientStates: Record<string, { status: ClientStatus; configPath?: string; message?: string; lastSyncAt: string }> = {};
    for (const result of results) {
      clientStates[result.clientId] = {
        status: result.status,
        configPath: result.configPath,
        message: result.message,
        lastSyncAt: new Date().toISOString(),
      };
    }

    const hasErrors = results.some((r) => r.status === "ERROR")
      || imports.conflicts.length > 0
      || imports.errors.length > 0;

    return {
      gatewayUrl,
      imports,
      results,
      hasErrors,
      clientStates,
      phaseErrors: allPhaseErrors.length > 0 ? allPhaseErrors : undefined,
      pluginResults: pluginResults.length > 0 ? pluginResults : undefined,
    };
  });
}

export function persistSyncState(summary: SyncSummary, config: McpxConfig): void {
  if (!summary.clientStates) return;
  for (const [clientId, state] of Object.entries(summary.clientStates)) {
    config.clients[clientId as ClientId] = state;
  }
}
