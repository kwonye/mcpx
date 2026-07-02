// Config
export { loadConfig, saveConfig, defaultConfig, loadMergedConfig, loadProjectConfig, saveProjectConfig, ConfigLoadError, migrateProjectServers } from "./config.js";
export { mutateConfig } from "./config-store.js";

// Errors
export { UpstreamError, SecretNotFoundError, classifyUpstreamError } from "./errors.js";
export type { UpstreamErrorCode } from "./errors.js";
export { parseCliAddCommand, tokenizeCommandLine } from "./add-command.js";
export { buildEnrichedPath } from "./spawn-env.js";
export { runOAuthLogin, getOAuthAccessToken, isOAuthReference, oauthReferenceServerName } from "./oauth.js";
export type { OAuthCodeReceiver } from "./oauth.js";

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
export { syncAllClients, getGatewayUrl, persistSyncState } from "./sync.js";
export type { SyncSummary } from "./sync.js";

// Registry (server add/remove)
export { addServer, removeServer, updateServer, setServerEnabled, setProjectServerEnabled, registerProject, unregisterProject, ensureGatewayToken, rotateGatewayToken } from "./registry.js";

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

// Plugin Management
export { PluginManager } from "./plugin-manager.js";
export { PluginCache } from "./plugin-cache.js";
export { PluginDataManager } from "./plugin-data.js";
export { syncPluginsToClient, prunePluginProjections, pruneAllPluginProjections } from "./plugin-projections.js";
export { PluginLifecycle } from "./plugin-lifecycle.js";
export { parseSource } from "./plugin-source.js";
export { readManifest, discoverComponents, hasManifest } from "./plugin-parse.js";

// Plugin management functions
export { inspectPlugin, installPlugin, preparePlugin, updatePlugin, uninstallPlugin, enablePlugin, disablePlugin, approvePluginComponent, getPluginStatus, listPlugins } from "./plugin-manager.js";

// Paths
export { getConfigPath, getManagedIndexPath } from "./paths.js";

// Update
export { checkForUpdates, getStagedUpdate, getStagedCliPath, clearStagedUpdate, compareVersions, shouldUseStagedCli } from "./update.js";
export type { UpdateStatus, StagedUpdateInfo } from "./update.js";
export { startBackgroundUpdateCheck, performUpdate, performRollback } from "./update-manager.js";

// Registry Client
export {
  fetchRegistryServerDetail,
  selectBestPackage,
  extractRequiredInputs,
  mapRegistryToSpec
} from "./registry-client.js";
export type { RequiredInput } from "./registry-client.js";

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
  ManagedGatewayEntry,
  ProjectConfig,
  ProjectScope,
  ManagedPlugin,
  PluginManifest,
  PluginComponent,
  PluginSource,
  DiscoveredComponents,
  DiscoveredComponent,
  PluginSyncInput,
  PluginSyncResult
} from "../types.js";
