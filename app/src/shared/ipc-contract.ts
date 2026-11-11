/**
 * Typed request/response shapes for every invoke channel in IPC.
 *
 * This file is type-only so the sandboxed preload can import it without
 * pulling in runtime dependencies. Handlers validate their arguments at
 * runtime with the matching schemas in `ipc-schemas.ts`.
 */
import type {
  AdoptionPlan,
  DaemonStartResult,
  HarnessInstallation,
  ManagementSnapshot,
  Operation,
  SecretBackendSwitchResult,
  SyncMode,
  ManagedMarketplace,
  ManagedPlugin,
  MarketplaceListing,
  MarketplacePluginDetail,
  OAuthSupport,
  PluginComponent,
  ShareEnvironment,
  ShareLock,
  Skill,
  StatusReport,
  SyncSummary,
  TelemetryPreferences,
  TelemetryStatus,
  UpstreamServerSpec
} from "@mcpx/core";
import type { IPC } from "./ipc-channels";
import type { DesktopSettings, DesktopSettingsPatch } from "./desktop-settings";

export interface PendingAuthEntry {
  serverName: string;
  oauthLikely?: boolean;
  oauthSupport?: OAuthSupport;
  status?: number;
}

export type OAuthPhase = "discovering" | "awaiting-browser" | "exchanging" | "syncing" | "done" | "cancelled" | "error";

export interface OAuthProgressPayload {
  serverName: string;
  phase: OAuthPhase | (string & {});
  authorizationUrl?: string;
  expiresAt?: number;
  message?: string;
}

export interface TokenCount {
  tools: number;
  resources: number;
  prompts: number;
  total: number;
  error?: string;
  runtimeError?: string;
  errorCode?: string;
  runtimeErrorCode?: string;
}

/** Slow half of the status report: per-server context cost from the running gateway. */
export interface TokenCountsReport {
  gatewayRunning: boolean;
  counts: Record<string, TokenCount>;
  totalGlobalTokens: number;
  totalProjectTokens: Record<string, number>;
}

export type ServerInputKind = "url" | "command" | "client-command";

export interface ParsedServerInput {
  kind: ServerInputKind;
  /** Suggested (or, for pasted client commands, declared) server name. */
  name: string;
  spec: UpstreamServerSpec;
  force?: boolean;
}

export interface AddServerRequest {
  name: string;
  spec: UpstreamServerSpec;
  /** Secret values keyed by secret name; the spec references them as secret://<name>. */
  secrets?: Record<string, string>;
  force?: boolean;
}

export interface AuthProbe {
  authRequired?: boolean;
  authStatus?: number;
  oauthLikely?: boolean;
  oauthSupport?: OAuthSupport;
}

export interface AddServerResult extends AuthProbe {
  added: string;
  sync: SyncSummary;
}

export type SecretBackendKind = "file" | "keychain";

export interface ConfigureAuthRequest {
  serverName: string;
  /** HTTP servers: the header to send (default Authorization). */
  headerName?: string;
  /** Local commands: the environment variable to set. */
  envName?: string;
  authValue: string;
  secretName?: string;
  raw?: boolean;
}

export interface OAuthSupportResult {
  support: OAuthSupport;
  resourceMetadata?: boolean;
  authorizationServerMetadata?: boolean;
}

export interface ProjectServerToggleResult {
  updated: string;
  projectPath: string;
  enabled: boolean;
  sync: SyncSummary;
  effective?: boolean;
  reason?: string;
}

export interface PluginProjectOverride {
  enabled?: boolean;
  components?: Partial<Record<PluginComponent, boolean>>;
}

export interface MarketplaceRefreshResult {
  marketplace: ManagedMarketplace;
  updated: string[];
  errors: string[];
}

export interface ShareImportOptions {
  locked?: boolean;
  dryRun?: boolean;
  inputs?: Record<string, string>;
}

export interface ShareImportResult {
  importedSkills: string[];
  importedPlugins: string[];
  importedServers: string[];
  missingInputs: string[];
}

export interface ShareExportOptions {
  skills?: string[];
  plugins?: string[];
}

export interface ShareExportResult {
  environment: ShareEnvironment;
  lock: ShareLock;
}

export interface UpdateCheckResult {
  status: "up-to-date" | "available" | "downloaded" | "error" | "unsupported" | (string & {});
  message: string;
}

export interface OpenDashboardRequest {
  route?: string;
}

/** Tabs the anonymous desktop_tab_viewed event may report. */
export type TelemetryTab = "servers" | "projects" | "plugins" | "settings";

type Ok<T extends object = object> = T & { success: true };

/** Channel -> [argument tuple, result]. */
export interface IpcContract {
  [IPC.OPEN_DASHBOARD]: [[request?: OpenDashboardRequest], void];
  [IPC.QUIT_APP]: [[], void];

  [IPC.GET_STATUS]: [[], StatusReport];
  [IPC.GET_TOKEN_COUNTS]: [[], TokenCountsReport];
  [IPC.SYNC_ALL]: [[], SyncSummary];
  [IPC.DAEMON_START]: [[], DaemonStartResult];
  [IPC.DAEMON_STOP]: [[], { stopped: boolean; message: string }];
  [IPC.DAEMON_RESTART]: [[], DaemonStartResult];

  [IPC.MANAGEMENT_SNAPSHOT]: [[], ManagementSnapshot];
  [IPC.ADOPTION_PLAN]: [[harnesses?: string[]], AdoptionPlan];
  [IPC.ADOPTION_APPLY]: [[plan: AdoptionPlan, itemIds: string[]], Operation];
  [IPC.OPERATION_ROLLBACK]: [[operationId: string], Operation];
  [IPC.HARNESS_SET_MODE]: [[harnessId: string, mode: SyncMode], { id: string; mode: SyncMode }];

  [IPC.GET_SECRET_BACKEND]: [[], SecretBackendKind];
  [IPC.SET_SECRET_BACKEND]: [[backend: SecretBackendKind], SecretBackendSwitchResult];

  [IPC.GET_DESKTOP_SETTINGS]: [[], DesktopSettings];
  [IPC.UPDATE_DESKTOP_SETTINGS]: [[patch: DesktopSettingsPatch], DesktopSettings];
  [IPC.GET_TELEMETRY_STATUS]: [[], TelemetryStatus];
  [IPC.ACKNOWLEDGE_TELEMETRY_NOTICE]: [[], TelemetryPreferences];
  [IPC.UPDATE_TELEMETRY_PREFERENCES]: [
    [patch: { usageAnalyticsEnabled?: boolean; errorReportingEnabled?: boolean }],
    TelemetryPreferences
  ];
  [IPC.RESET_TELEMETRY_ID]: [[], TelemetryPreferences];
  [IPC.CAPTURE_DESKTOP_TAB_VIEWED]: [[tab: TelemetryTab], void];
  [IPC.CHECK_FOR_UPDATES]: [[], UpdateCheckResult];

  [IPC.PARSE_SERVER_INPUT]: [[input: string], ParsedServerInput];
  [IPC.ADD_SERVER]: [[request: AddServerRequest], AddServerResult];
  [IPC.UPDATE_SERVER]: [[name: string, spec: UpstreamServerSpec, secrets?: Record<string, string>], { updated: string; sync: SyncSummary }];
  [IPC.REMOVE_SERVER]: [[name: string], { removed: string; sync: SyncSummary }];
  [IPC.SET_SERVER_ENABLED]: [[name: string, enabled: boolean], { updated: string; enabled: boolean; sync: SyncSummary }];

  [IPC.CONFIGURE_AUTH]: [[request: ConfigureAuthRequest], { configured: true; sync: SyncSummary }];
  [IPC.GET_PENDING_AUTH]: [[], PendingAuthEntry[]];
  [IPC.REQUEST_AUTH]: [[serverName: string], { opened: true }];
  [IPC.DISMISS_AUTH]: [[serverName: string], { dismissed: string }];
  [IPC.CHECK_OAUTH_SUPPORT]: [[serverName: string], OAuthSupportResult];
  [IPC.START_OAUTH]: [[serverName: string], { serverName: string; authorized: true }];
  [IPC.CANCEL_OAUTH]: [[serverName: string], { cancelled: boolean }];
  [IPC.OAUTH_REOPEN]: [[serverName: string], { reopened: boolean }];

  [IPC.PROJECT_INIT]: [[projectPath: string, name: string], { success: true; sync: SyncSummary }];
  [IPC.PROJECT_REMOVE]: [[projectPath: string], { success: true; sync: SyncSummary }];
  [IPC.PROJECT_SET_SERVER_ENABLED]: [[projectPath: string, serverName: string, enabled: boolean], ProjectServerToggleResult];
  [IPC.SELECT_DIRECTORY]: [[], string | null];

  [IPC.LIST_SKILLS]: [[], Skill[]];
  [IPC.SAVE_SKILL]: [[id: string, content: string], Ok<{ id: string }>];
  [IPC.DELETE_SKILL]: [[id: string], Ok<{ id: string }>];
  [IPC.INSTALL_SKILL]: [[source: string, skill?: string], Skill];
  [IPC.CUSTOMIZE_SKILL]: [[id: string, name?: string], Skill];
  [IPC.PIN_SKILL]: [[id: string], Ok<{ id: string }>];
  [IPC.UNPIN_SKILL]: [[id: string], Ok<{ id: string }>];
  [IPC.UPDATE_SKILL]: [[id: string], Skill];
  [IPC.ROLLBACK_SKILL]: [[id: string], Skill];

  [IPC.SHARE_EXPORT]: [[directory: string, options?: ShareExportOptions], ShareExportResult];
  [IPC.SHARE_IMPORT]: [[directory: string, options?: ShareImportOptions], ShareImportResult];

  [IPC.PLUGIN_LIST]: [[], ManagedPlugin[]];
  [IPC.PLUGIN_INSTALL]: [[source: string], ManagedPlugin];
  [IPC.PLUGIN_UPDATE]: [[id: string], ManagedPlugin];
  [IPC.PLUGIN_PIN]: [[id: string], Ok<{ name: string }>];
  [IPC.PLUGIN_UNPIN]: [[id: string], Ok<{ name: string }>];
  [IPC.PLUGIN_ROLLBACK]: [[id: string], ManagedPlugin];
  [IPC.PLUGIN_UNINSTALL]: [[id: string, keepData?: boolean], Ok<{ name: string }>];
  [IPC.PLUGIN_ENABLE]: [[id: string], Ok<{ name: string }>];
  [IPC.PLUGIN_DISABLE]: [[id: string], Ok<{ name: string }>];
  [IPC.PLUGIN_APPROVE]: [[id: string, component: PluginComponent], Ok<{ name: string; component: string }>];
  [IPC.PLUGIN_SET_PROJECT_OVERRIDE]: [[id: string, projectPath: string, override: PluginProjectOverride], Ok<{ name: string; projectPath: string }>];
  [IPC.PLUGIN_RESET_PROJECT_OVERRIDE]: [[id: string, projectPath: string], Ok<{ name: string; projectPath: string }>];

  [IPC.MARKETPLACE_LIST]: [[], ManagedMarketplace[]];
  [IPC.MARKETPLACE_ADD]: [[source: string, manifestPath?: string], ManagedMarketplace];
  [IPC.MARKETPLACE_REFRESH]: [[name: string], MarketplaceRefreshResult];
  [IPC.MARKETPLACE_REMOVE]: [[name: string], Ok<{ name: string }>];
  [IPC.MARKETPLACE_SET_AUTO_UPDATE]: [[name: string, enabled: boolean], ManagedMarketplace];
  [IPC.MARKETPLACE_BROWSE]: [[query?: string], MarketplaceListing[]];
  [IPC.MARKETPLACE_INSPECT_PLUGIN]: [[id: string], MarketplacePluginDetail];
  [IPC.MARKETPLACE_INSTALL_PLUGIN]: [[id: string], ManagedPlugin];
}

export type InvokeChannel = keyof IpcContract;
export type IpcArgs<C extends InvokeChannel> = IpcContract[C][0];
export type IpcResult<C extends InvokeChannel> = IpcContract[C][1];

export type { AdoptionPlan, HarnessInstallation, ManagementSnapshot, Operation, SyncMode };
