// Config
export { loadConfig, saveConfig, defaultConfig } from "./config.js";

// Daemon
export { getDaemonStatus, startDaemon, stopDaemon, restartDaemon, readDaemonLogs } from "./daemon.js";
export type { DaemonStatus } from "./daemon.js";

// Sync
export { syncAllClients, getGatewayUrl } from "./sync.js";
export type { SyncSummary } from "./sync.js";

// Registry (server add/remove)
export { addServer, removeServer } from "./registry.js";

// Secrets
export { SecretsManager } from "./secrets.js";

// Server Auth
export {
  applyAuthReference,
  removeAuthReference,
  listAuthBindings,
  resolveAuthTarget,
  defaultAuthSecretName,
  maybePrefixBearer,
  secretRefName,
  toSecretRef
} from "./server-auth.js";

// Managed Index
export { loadManagedIndex } from "./managed-index.js";

// Paths
export { getConfigPath, getManagedIndexPath } from "./paths.js";

// Types (re-export from parent)
export type {
  McpxConfig,
  ClientId,
  ClientStatus,
  UpstreamServerSpec,
  HttpServerSpec,
  StdioServerSpec,
  GatewayConfig,
  ClientSyncState,
  ManagedIndex,
  ManagedEntry,
  ManagedClientState,
  SyncResult,
  ManagedGatewayEntry
} from "../types.js";
