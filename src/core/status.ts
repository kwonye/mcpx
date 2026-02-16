import { getDaemonStatus, type DaemonStatus } from "./daemon.js";
import { getGatewayUrl } from "./sync.js";
import { listAuthBindings, secretRefName } from "./server-auth.js";
import type { ClientId, ClientStatus, ManagedIndex, McpxConfig, UpstreamServerSpec } from "../types.js";

export const STATUS_CLIENTS: ClientId[] = ["claude", "codex", "cursor", "cline", "opencode", "kiro", "vscode"];

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
  transport: UpstreamServerSpec["transport"];
  target: string;
  authBindings: StatusAuthBinding[];
  clients: StatusClientMapping[];
}

export interface StatusReport {
  gatewayUrl: string;
  daemon: DaemonStatus;
  upstreamCount: number;
  servers: StatusServerEntry[];
  clients: McpxConfig["clients"];
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
    const managedEntry = managedClient?.entries?.[serverName];
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

export function buildStatusReport(
  config: McpxConfig,
  managedIndex: ManagedIndex,
  daemon: DaemonStatus = getDaemonStatus(config)
): StatusReport {
  const serverNames = Object.keys(config.servers).sort((left, right) => left.localeCompare(right));
  const servers = serverNames.map((name) => {
    const spec = config.servers[name];
    return {
      name,
      transport: spec.transport,
      target: describeServerTarget(spec),
      authBindings: buildAuthBindings(spec),
      clients: buildClientMappings(config, managedIndex, name)
    };
  });

  return {
    gatewayUrl: getGatewayUrl(config),
    daemon,
    upstreamCount: servers.length,
    servers,
    clients: config.clients
  };
}
