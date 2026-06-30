import type {
  ClientId,
  ManagedGatewayEntry,
  McpxConfig,
  ProjectScope,
  SyncImportReport,
  SyncResult,
  PluginSyncInput
} from "../types.js";
import { isServerEnabled } from "../types.js";
import { managedGatewayEntryName } from "../adapters/utils/index.js";
import { getAdapters } from "../adapters/index.js";
import { serverSpecsEqual } from "../adapters/utils/index.js";
import { loadManagedIndex, saveManagedIndex } from "./managed-index.js";
import { getManagedIndexPath } from "./paths.js";
import { ensureGatewayToken } from "./registry.js";
import { saveConfig } from "./config.js";
import { SecretsManager } from "./secrets.js";
import { listSkills } from "./skills.js";

export interface SyncSummary {
  gatewayUrl: string;
  imports: SyncImportReport;
  results: SyncResult[];
  hasErrors: boolean;
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
  return Object.values(config.projects ?? {}).map((project) => {
    const disabledServerNames = (project.disabledServers ?? [])
      // Only servers that are globally enabled can be effectively subtracted per project;
      // globally disabled ones aren't in root mcpServers anyway.
      .filter((name) => globallyEnabled.has(name))
      .map((name) => managedGatewayEntryName(name));
    return { path: project.path, disabledServerNames };
  });
}

function buildManagedEntries(config: McpxConfig, gatewayUrl: string, localToken: string): ManagedGatewayEntry[] {
  const entries = Object.entries(config.servers);
  return entries.map(([name, spec]) => ({
    name: `${name} (mcpx)`,
    url: `${gatewayUrl}?upstream=${encodeURIComponent(name)}`,
    headers: {
      Authorization: `Bearer ${localToken}`
    },
    enabled: isServerEnabled(spec)
  }));
}

function isClientInternalServerCommand(candidate: { spec: { transport: string; command?: string } }): boolean {
  return candidate.spec.transport === "stdio" && /\.app\/Contents\//.test(candidate.spec.command ?? "");
}

export function syncAllClients(config: McpxConfig, secrets: SecretsManager, targetClients?: ClientId[]): SyncSummary {
  const adapters = getAdapters();
  const managedIndexPath = getManagedIndexPath();
  const managedIndex = loadManagedIndex(managedIndexPath);
  const filteredAdapters = targetClients && targetClients.length > 0
    ? adapters.filter((adapter) => targetClients.includes(adapter.id))
    : adapters;
  const imports: SyncImportReport = {
    imported: [],
    duplicates: [],
    skipped: [],
    conflicts: [],
    errors: []
  };
  const sourceEntriesToRemove = new Map<ClientId, Set<string>>();

  for (const adapter of filteredAdapters) {
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
            reason: "client-internal server"
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
            serverName: candidate.serverName
          });
          if (!sourceEntriesToRemove.has(candidate.clientId)) {
            sourceEntriesToRemove.set(candidate.clientId, new Set<string>());
          }
          sourceEntriesToRemove.get(candidate.clientId)?.add(candidate.sourceEntryName);
          continue;
        }

        if (serverSpecsEqual(existing, candidate.spec)) {
          imports.duplicates.push({
            clientId: candidate.clientId,
            configPath: candidate.configPath,
            sourceEntryName: candidate.sourceEntryName,
            serverName: candidate.serverName
          });
          if (!sourceEntriesToRemove.has(candidate.clientId)) {
            sourceEntriesToRemove.set(candidate.clientId, new Set<string>());
          }
          sourceEntriesToRemove.get(candidate.clientId)?.add(candidate.sourceEntryName);
          continue;
        }

        imports.conflicts.push({
          clientId: candidate.clientId,
          configPath: candidate.configPath,
          sourceEntryName: candidate.sourceEntryName,
          serverName: candidate.serverName,
          message: `Server "${candidate.serverName}" already exists in mcpx with a different configuration.`
        });
      }
    } catch (error) {
      imports.errors.push({
        clientId: adapter.id,
        configPath: adapter.detectConfigPath() ?? undefined,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const localToken = ensureGatewayToken(config, secrets);
  const gatewayUrl = getGatewayUrl(config);
  const managedEntries = buildManagedEntries(config, gatewayUrl, localToken);
  const skills = listSkills();

  const results: SyncResult[] = [];

  // Build plugin sync inputs
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

  for (const adapter of filteredAdapters) {
    if (adapter.syncSkills) {
      try {
        adapter.syncSkills(skills);
      } catch (error) {
        // Log or handle skill sync error if needed, for now we continue
      }
    }

    // Dispatch plugin sync to adapters that support it
    if (adapter.syncPlugins && pluginInputs.length > 0) {
      try {
        adapter.syncPlugins(pluginInputs);
      } catch (error) {
        // Plugin sync error; continue
      }
    }

    if (!adapter.supportsHttp()) {
      results.push({
        clientId: adapter.id,
        status: "UNSUPPORTED_HTTP",
        message: "Client adapter does not support MCP over HTTP."
      });
      continue;
    }

    const result = adapter.syncGateway(config, {
      managedEntries,
      managedIndex,
      managedIndexPath,
      sourceEntriesToRemove: Array.from(sourceEntriesToRemove.get(adapter.id) ?? []),
      projectScopes: buildProjectScopes(config)
    });

    results.push(result);
  }

  for (const result of results) {
    config.clients[result.clientId] = {
      status: result.status,
      configPath: result.configPath,
      message: result.message,
      lastSyncAt: new Date().toISOString()
    };
  }

  saveManagedIndex(managedIndex, managedIndexPath);
  saveConfig(config);

  const hasErrors = results.some((result) => result.status === "ERROR")
    || imports.conflicts.length > 0
    || imports.errors.length > 0;

  return {
    gatewayUrl,
    imports,
    results,
    hasErrors
  };
}
