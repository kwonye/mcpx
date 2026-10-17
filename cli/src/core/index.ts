// Config
export { loadConfig, saveConfig, defaultConfig, loadMergedConfig, loadProjectConfig, saveProjectConfig, ConfigLoadError, migrateProjectServers } from "./config.js";
export { mutateConfig, mutateProjectConfig, mutateActiveConfig } from "./config-store.js";

// Anonymous telemetry
export {
  TELEMETRY_NOTICE_VERSION,
  acknowledgeTelemetryNotice,
  architecture,
  captureTelemetryEvent,
  countBucket,
  defaultTelemetryPreferences,
  durationBucket,
  getTelemetryStatus,
  initializeTelemetry,
  isTelemetryEnvironmentDisabled,
  loadTelemetryPreferences,
  markTelemetryMilestone,
  platformFamily,
  resetTelemetryInstallationId,
  reportTelemetryError,
  setTelemetryErrorReporter,
  shutdownTelemetry,
  updateTelemetryPreferences,
  flushTelemetry,
  uptimeBucket
} from "./telemetry.js";
export type { TelemetryErrorContext, TelemetryErrorReporter, TelemetryEvent, TelemetryPreferences, TelemetryRuntime, TelemetryRuntimeMetadata, TelemetryStatus } from "./telemetry.js";

// Errors
export { UpstreamError, SecretNotFoundError, classifyUpstreamError } from "./errors.js";
export type { UpstreamErrorCode } from "./errors.js";
export { parseCliAddCommand, tokenizeCommandLine } from "./add-command.js";
export { buildEnrichedPath } from "./spawn-env.js";
export {
  runOAuthLogin,
  getOAuthAccessToken,
  isOAuthReference,
  oauthReferenceServerName,
  probeOAuthSupport,
  __resetOAuthSupportCache,
  oauthSecretNames,
  clearOAuthCredentials,
  getOAuthCredentialStatus,
  OAuthCancelledError,
  OAuthLoginInProgressError,
  OAUTH_LOGIN_TIMEOUT_MS
} from "./oauth.js";
export type {
  OAuthCodeReceiver,
  OAuthSupport,
  OAuthSupportProbe,
  OAuthSecretNames,
  OAuthCredentialStatus,
  OAuthProgressEvent,
  RunOAuthLoginOptions
} from "./oauth.js";

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
export { syncAllClients, getGatewayUrl, getGatewayInternalUrl, persistSyncState } from "./sync.js";
export type { SyncSummary } from "./sync.js";

// Registry (server add/remove)
export { addServer, removeServer, updateServer, setServerEnabled, setProjectServerEnabled, registerProject, unregisterProject, ensureGatewayToken, rotateGatewayToken } from "./registry.js";

// Skills
export { listSkills, getSkill, saveSkill, deleteSkill, customizeSkill, installSkillFromSource, validateSkillPackage, pinSkill, unpinSkill, updateSkill, rollbackSkill } from "./skills.js";
export { exportEnvironment, importEnvironment } from "./share.js";
export type { ShareEnvironment, ShareLock } from "./share.js";

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
export {
  addMarketplace,
  removeMarketplace,
  refreshMarketplace,
  refreshMarketplaceWithPlugins,
  setMarketplaceAutoUpdate,
  listMarketplaces,
  listMarketplacePlugins,
  inspectMarketplacePlugin,
  installMarketplacePlugin,
  updateMarketplaceInstalledPlugin,
} from "./marketplace.js";
export { startMarketplaceAutoUpdater, runMarketplaceAutoUpdate } from "./marketplace-updater.js";

// Plugin management functions
export { inspectPlugin, installPlugin, preparePlugin, updatePlugin, pinPlugin, unpinPlugin, rollbackPlugin, uninstallPlugin, enablePlugin, disablePlugin, setPluginProjectOverride, resetPluginProjectOverride, approvePluginComponent, getPluginStatus, listPlugins, pluginConfigSet, pluginSync, resolvePluginId } from "./plugin-manager.js";

// Paths
export { getConfigPath, getManagedIndexPath, getTelemetryPath, getSkillsDir, getSkillPackagesRoot } from "./paths.js";

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
  ManagedMarketplace,
  MarketplaceListing,
  MarketplacePluginDetail,
  MarketplaceFormat,
  PluginManifest,
  PluginComponent,
  PluginSource,
  DiscoveredComponents,
  DiscoveredComponent,
  PluginSyncInput,
  PluginSyncResult,
  Skill
} from "../types.js";
