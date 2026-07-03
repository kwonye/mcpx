import type {
  ClientId,
  ClientImportScanResult,
  ClientImportSkippedEntry,
  ManagedGatewayEntry,
  ManagedIndex,
  SyncResult,
  UpstreamServerSpec
} from "../../types.js";
import { sha256 } from "../../util/fs.js";

export function getManagedEntryNames(managedIndex: ManagedIndex, clientId: ClientId): string[] {
  return Object.keys(managedIndex.managed[clientId]?.entries ?? {});
}

export function isManagedEntry(managedIndex: ManagedIndex, clientId: ClientId, entryName: string): boolean {
  return Boolean(managedIndex.managed[clientId]?.entries?.[entryName]);
}

export function pruneStaleManagedEntries(
  managedIndex: ManagedIndex,
  clientId: ClientId,
  servers: Record<string, unknown>,
  keepEntryNames: string[]
): void {
  const keep = new Set(keepEntryNames);
  const managedNames = getManagedEntryNames(managedIndex, clientId);
  for (const name of managedNames) {
    if (!keep.has(name)) {
      delete servers[name];
    }
  }

  for (const name of Object.keys(servers)) {
    if (!keep.has(name) && name.endsWith(" (mcpx)")) {
      delete servers[name];
    }
  }
}

export function ensureManagedEntryWritable(
  managedIndex: ManagedIndex,
  clientId: ClientId,
  entryName: string,
  existingValue: unknown,
  expectedEntry?: { url?: string; headers?: Record<string, string>; command?: string; args?: string[] }
): string | null {
  if (existingValue === undefined || existingValue === null) {
    return null;
  }

  if (isManagedEntry(managedIndex, clientId, entryName)) {
    return null;
  }

  if (expectedEntry && isManagedGatewayProjection(entryName) && matchesExpectedShape(existingValue, expectedEntry)) {
    if (!managedIndex.managed[clientId]) {
      managedIndex.managed[clientId] = { configPath: "", entries: {} };
    }
    managedIndex.managed[clientId].entries[entryName] = {
      fingerprint: sha256(JSON.stringify(existingValue)),
      lastSyncedAt: new Date().toISOString()
    };
    return null;
  }

  return `Cannot sync managed entry \"${entryName}\" because an unmanaged entry already exists.`;
}

function matchesExpectedShape(value: unknown, expected: { url?: string; headers?: Record<string, string>; command?: string; args?: string[] }): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (expected.url && v.url !== expected.url) return false;
  if (expected.command && v.command !== expected.command) return false;
  return true;
}

export function setManagedEntries(
  managedIndex: ManagedIndex,
  clientId: ClientId,
  configPath: string,
  entries: Record<string, string>
): void {
  if (!managedIndex.managed[clientId]) {
    managedIndex.managed[clientId] = {
      configPath,
      entries: {}
    };
  }

  managedIndex.managed[clientId].configPath = configPath;
  managedIndex.managed[clientId].entries = Object.fromEntries(
    Object.entries(entries).map(([entryName, serializedEntry]) => [entryName, {
      fingerprint: sha256(serializedEntry),
      lastSyncedAt: new Date().toISOString()
    }])
  );
}

export function okResult(clientId: ClientId, configPath: string, message?: string): SyncResult {
  return {
    clientId,
    status: "SYNCED",
    configPath,
    message
  };
}

export function unsupportedResult(clientId: ClientId, message: string): SyncResult {
  return {
    clientId,
    status: "UNSUPPORTED_HTTP",
    message
  };
}

export function errorResult(clientId: ClientId, configPath: string | undefined, message: string): SyncResult {
  return {
    clientId,
    status: "ERROR",
    configPath,
    message
  };
}

export function skippedResult(clientId: ClientId, message: string): SyncResult {
  return {
    clientId,
    status: "SKIPPED",
    message
  };
}

export function managedGatewayEntryName(serverName: string): string {
  return `${serverName} (mcpx)`;
}

export function isManagedGatewayProjection(entryName: string): boolean {
  return entryName.endsWith(" (mcpx)");
}

function sortRecord(record: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!record || Object.keys(record).length === 0) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

export function normalizeServerSpec(spec: UpstreamServerSpec): UpstreamServerSpec {
  if (spec.transport === "http") {
    return {
      transport: "http",
      url: spec.url,
      headers: sortRecord(spec.headers)
    };
  }

  return {
    transport: "stdio",
    command: spec.command,
    args: spec.args && spec.args.length > 0 ? [...spec.args] : undefined,
    env: sortRecord(spec.env),
    cwd: spec.cwd
  };
}

export function serializeServerSpec(spec: UpstreamServerSpec): string {
  return JSON.stringify(normalizeServerSpec(spec));
}

export function serverSpecsEqual(left: UpstreamServerSpec, right: UpstreamServerSpec): boolean {
  return serializeServerSpec(left) === serializeServerSpec(right);
}

export function emptyImportScan(clientId: ClientId, configPath?: string): ClientImportScanResult {
  return {
    clientId,
    configPath,
    candidates: [],
    skipped: []
  };
}

export function buildImportSkip(
  clientId: ClientId,
  sourceEntryName: string,
  reason: string,
  configPath?: string,
  serverName = sourceEntryName
): ClientImportSkippedEntry {
  return {
    clientId,
    configPath,
    sourceEntryName,
    serverName,
    reason
  };
}

export function removeSourceEntries(entries: Record<string, unknown>, names: string[] | undefined): void {
  for (const name of names ?? []) {
    delete entries[name];
  }
}

/**
 * Purge managed entry names from the native disabledMcpServers array.
 * Disabled managed servers are simply absent from the client config (no entry written).
 */
export function purgeManagedFromDisabledArray(
  raw: Record<string, unknown>,
  managedNames: string[]
): void {
  const existingDisabled = (raw.disabledMcpServers as string[] | undefined) ?? [];
  raw.disabledMcpServers = existingDisabled.filter((name) => !managedNames.includes(name));
  if (Array.isArray(raw.disabledMcpServers) && raw.disabledMcpServers.length === 0) {
    delete raw.disabledMcpServers;
  }
}

/**
 * Purge managed entry names from the mcp.excluded array.
 * Disabled managed servers are simply absent from the client config (no entry written).
 */
export function purgeManagedFromExcludedArray(
  raw: Record<string, unknown>,
  managedNames: string[]
): void {
  const mcp = ((raw.mcp as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  const existingExcluded = (mcp.excluded as string[] | undefined) ?? [];
  mcp.excluded = existingExcluded.filter((name) => !managedNames.includes(name));
  if (Array.isArray(mcp.excluded) && mcp.excluded.length === 0) {
    delete mcp.excluded;
  }
  raw.mcp = Object.keys(mcp).length > 0 ? mcp : undefined;
}

export function detectManagedEntryDrift(
  managedIndex: ManagedIndex,
  clientId: ClientId,
  entryName: string,
  existingValue: unknown
): boolean {
  const recorded = managedIndex.managed[clientId]?.entries?.[entryName];
  if (!recorded || existingValue === undefined) return false;
  const liveFingerprint = sha256(JSON.stringify(existingValue));
  return liveFingerprint !== recorded.fingerprint;
}
