import type { ClientId, ManagedIndex, SyncResult } from "../../types.js";
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
}

export function ensureManagedEntryWritable(
  managedIndex: ManagedIndex,
  clientId: ClientId,
  entryName: string,
  existingValue: unknown
): string | null {
  if (existingValue === undefined || existingValue === null) {
    return null;
  }

  if (isManagedEntry(managedIndex, clientId, entryName)) {
    return null;
  }

  return `Cannot sync managed entry \"${entryName}\" because an unmanaged entry already exists.`;
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
