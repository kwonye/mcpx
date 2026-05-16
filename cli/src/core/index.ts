// Config
export { loadConfig, saveConfig, defaultConfig } from "./config.js";

// Daemon
export {
  getDaemonStatus,
  startDaemon,
  stopDaemon,
  restartDaemon,
  readDaemonLogs,
  runDaemonForeground
} from "./daemon.js";
export type { DaemonStatus, DaemonStartResult } from "./daemon.js";

// Sync
export { syncAllClients, getGatewayUrl } from "./sync.js";
export type { SyncSummary } from "./sync.js";

// Registry (server add/remove)
export { addServer, removeServer, updateServer, setServerEnabled } from "./registry.js";

// Skills
export { listSkills, getSkill, saveSkill, deleteSkill } from "./skills.js";

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

// Status
export { buildStatusReport, STATUS_CLIENTS } from "./status.js";
export type { StatusReport, StatusServerEntry, StatusClientMapping, StatusAuthBinding } from "./status.js";

// Auth Probe
export { probeHttpAuthRequirement } from "./auth-probe.js";
export type { HttpAuthProbeResult } from "./auth-probe.js";

// Managed Index
export { loadManagedIndex } from "./managed-index.js";

// Paths
export { getConfigPath, getManagedIndexPath } from "./paths.js";

// Update
export { checkForUpdates, getStagedUpdate, getStagedCliPath, clearStagedUpdate, compareVersions } from "./update.js";
export type { UpdateStatus, StagedUpdateInfo } from "./update.js";
export { startBackgroundUpdateCheck, performUpdate, performRollback } from "./update-manager.js";

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
  ClientImportCandidate,
  ClientImportScanResult,
  ClientImportSkippedEntry,
  SyncImportReport,
  SyncImportedEntry,
  SyncDuplicateImportEntry,
  SyncImportConflictEntry,
  SyncImportErrorEntry,
  SyncResult,
  ManagedGatewayEntry
} from "../types.js";
