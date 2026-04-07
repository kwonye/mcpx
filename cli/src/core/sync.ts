import type {
  ClientId,
  ManagedGatewayEntry,
  McpxConfig,
  SyncImportReport,
  SyncResult
} from "../types.js";
import { isServerEnabled } from "../types.js";
import { getAdapters } from "../adapters/index.js";
import { serverSpecsEqual } from "../adapters/utils/index.js";
import { loadManagedIndex, saveManagedIndex } from "./managed-index.js";
import { getManagedIndexPath } from "./paths.js";
import { ensureGatewayToken } from "./registry.js";
import { saveConfig } from "./config.js";
import { SecretsManager } from "./secrets.js";

export interface SyncSummary {
  gatewayUrl: string;
  imports: SyncImportReport;
  results: SyncResult[];
  hasErrors: boolean;
}

export function getGatewayUrl(config: McpxConfig): string {
  return `http://127.0.0.1:${config.gateway.port}/mcp`;
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

  const results: SyncResult[] = [];

  for (const adapter of filteredAdapters) {
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
      sourceEntriesToRemove: Array.from(sourceEntriesToRemove.get(adapter.id) ?? [])
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
