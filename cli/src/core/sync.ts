import type { ClientId, ManagedGatewayEntry, McpxConfig, SyncResult } from "../types.js";
import { getAdapters } from "../adapters/index.js";
import { loadManagedIndex, saveManagedIndex } from "./managed-index.js";
import { getManagedIndexPath } from "./paths.js";
import { ensureGatewayToken } from "./registry.js";
import { saveConfig } from "./config.js";
import { SecretsManager } from "./secrets.js";

export interface SyncSummary {
  gatewayUrl: string;
  results: SyncResult[];
  hasErrors: boolean;
}

export function getGatewayUrl(config: McpxConfig): string {
  return `http://127.0.0.1:${config.gateway.port}/mcp`;
}

function buildManagedEntries(config: McpxConfig, gatewayUrl: string, localToken: string): ManagedGatewayEntry[] {
  const names = Object.keys(config.servers);
  return names.map((name) => ({
    name,
    url: `${gatewayUrl}?upstream=${encodeURIComponent(name)}`,
    headers: {
      "x-mcpx-local-token": localToken
    }
  }));
}

export function syncAllClients(config: McpxConfig, secrets: SecretsManager, targetClients?: ClientId[]): SyncSummary {
  const adapters = getAdapters();
  const managedIndexPath = getManagedIndexPath();
  const managedIndex = loadManagedIndex(managedIndexPath);
  const localToken = ensureGatewayToken(config, secrets);
  const gatewayUrl = getGatewayUrl(config);
  const managedEntries = buildManagedEntries(config, gatewayUrl, localToken);

  const filteredAdapters = targetClients && targetClients.length > 0
    ? adapters.filter((adapter) => targetClients.includes(adapter.id))
    : adapters;

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
      managedIndexPath
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

  const hasErrors = results.some((result) => result.status === "ERROR");

  return {
    gatewayUrl,
    results,
    hasErrors
  };
}
