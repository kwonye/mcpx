import { getDaemonStatus, type DaemonStatus } from "./daemon.js";
import { getGatewayUrl } from "./sync.js";
import { listAuthBindings, secretRefName } from "./server-auth.js";
import { isServerEnabled, type ClientId, type ClientStatus, type ManagedIndex, type McpxConfig, type UpstreamServerSpec, type UpstreamTokenCount } from "../types.js";
import { SecretsManager } from "./secrets.js";
import { ensureGatewayToken } from "./registry.js";

export const STATUS_CLIENTS: ClientId[] = ["claude", "claude-desktop", "codex", "cursor", "cline", "opencode", "kiro", "vscode", "qwen"];

export interface StatusAuthBinding {
  kind: "header" | "env";
  key: string;
  value: string;
  secretName?: string;
}

export interface StatusClientMapping {
  clientId: ClientId;
  managed: boolean;
  status: ClientStatus;
  configPath?: string;
  message?: string;
  lastSyncAt?: string;
}

export interface StatusServerEntry {
  name: string;
  enabled: boolean;
  transport: UpstreamServerSpec["transport"];
  target: string;
  authBindings: StatusAuthBinding[];
  clients: StatusClientMapping[];
  tokenCount?: UpstreamTokenCount;
}

export interface StatusReport {
  gatewayUrl: string;
  daemon: DaemonStatus;
  upstreamCount: number;
  servers: StatusServerEntry[];
  clients: McpxConfig["clients"];
  projects?: McpxConfig["projects"];
  totalGlobalTokens?: number;
  totalProjectTokens?: Record<string, number>;
}

function describeServerTarget(spec: UpstreamServerSpec): string {
  if (spec.transport === "http") {
    return spec.url;
  }

  const args = (spec.args ?? []).join(" ");
  const command = `${spec.command}${args ? ` ${args}` : ""}`;
  return spec.cwd ? `${command} (cwd: ${spec.cwd})` : command;
}

function deriveClientStatus(managed: boolean, configured?: ClientStatus): ClientStatus {
  if (configured) {
    return configured;
  }

  return managed ? "SYNCED" : "SKIPPED";
}

function buildClientMappings(config: McpxConfig, managedIndex: ManagedIndex, serverName: string): StatusClientMapping[] {
  return STATUS_CLIENTS.map((clientId) => {
    const configState = config.clients[clientId];
    const managedClient = managedIndex.managed[clientId];
    const managedEntry = managedClient?.entries?.[`${serverName} (mcpx)`];
    const managed = Boolean(managedEntry);

    return {
      clientId,
      managed,
      status: deriveClientStatus(managed, configState?.status),
      configPath: managedClient?.configPath ?? configState?.configPath,
      message: configState?.message,
      lastSyncAt: managedEntry?.lastSyncedAt ?? configState?.lastSyncAt
    };
  });
}

function buildAuthBindings(spec: UpstreamServerSpec): StatusAuthBinding[] {
  return listAuthBindings(spec).map((binding) => ({
    kind: binding.kind,
    key: binding.key,
    value: binding.value,
    secretName: secretRefName(binding.value) ?? undefined
  }));
}

async function fetchTokenCounts(gatewayUrl: string, token: string): Promise<Record<string, UpstreamTokenCount>> {
  try {
    const res = await fetch(gatewayUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "status-tokens",
        method: "custom/tokenCounts",
        params: {}
      })
    });
    if (!res.ok) {
      return {};
    }
    const data = await res.json() as any;
    return data?.result ?? {};
  } catch (error) {
    return {};
  }
}

export async function buildStatusReport(
  config: McpxConfig,
  managedIndex: ManagedIndex,
  daemon: DaemonStatus = getDaemonStatus(config)
): Promise<StatusReport> {
  const secrets = new SecretsManager();
  const token = ensureGatewayToken(config, secrets);
  const gatewayUrl = getGatewayUrl(config);

  let tokenCounts: Record<string, UpstreamTokenCount> = {};
  if (daemon.running) {
    tokenCounts = await fetchTokenCounts(gatewayUrl, token);
  }

  const projectEntries = Object.values(config.projects ?? {});
  let totalGlobalTokens = 0;
  const totalProjectTokens: Record<string, number> = {};

  const serverNames = Object.keys(config.servers).sort((left, right) => left.localeCompare(right));
  const servers = serverNames.map((name) => {
    const spec = config.servers[name];
    const tokenCount = tokenCounts[name];
    const serverEntry = {
      name,
      enabled: isServerEnabled(spec),
      transport: spec.transport,
      target: describeServerTarget(spec),
      authBindings: buildAuthBindings(spec),
      clients: buildClientMappings(config, managedIndex, name),
      tokenCount
    };

    if (serverEntry.enabled && tokenCount) {
      const matchingProject = projectEntries.find((p) => name.startsWith(`${p.name}.`));
      if (matchingProject) {
        totalProjectTokens[matchingProject.path] = (totalProjectTokens[matchingProject.path] ?? 0) + tokenCount.total;
      } else {
        totalGlobalTokens += tokenCount.total;
      }
    }

    return serverEntry;
  });

  return {
    gatewayUrl,
    daemon,
    upstreamCount: servers.length,
    servers,
    clients: config.clients,
    projects: config.projects,
    totalGlobalTokens,
    totalProjectTokens
  };
}
