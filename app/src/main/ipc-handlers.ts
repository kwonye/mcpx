import { app, ipcMain, dialog, shell, BrowserWindow } from "electron";
import {
  loadConfig,
  mutateConfig,
  loadMergedConfig,
  registerProject,
  unregisterProject,
  setProjectServerEnabled,
  getDaemonStatus,
  startDaemon,
  stopDaemon,
  restartDaemon,
  syncAllClients,
  persistSyncState,
  addServer,
  removeServer,
  setServerEnabled,
  updateServer,
  listSkills,
  saveSkill,
  deleteSkill,
  installSkillFromSource,
  customizeSkill,
  pinSkill,
  unpinSkill,
  updateSkill,
  rollbackSkill,
  exportEnvironment,
  importEnvironment,
  SecretsManager,
  buildStatusReport,
  loadManagedIndex,
  probeHttpAuthRequirement,
  probeOAuthSupport,
  applyAuthReference,
  resolveAuthTarget,
  toSecretRef,
  maybePrefixBearer,
  parseCliAddCommand,
  tokenizeCommandLine,
  runOAuthLogin,
  clearOAuthCredentials,
  ensureGatewayToken,
  getTelemetryStatus,
  architecture,
  acknowledgeTelemetryNotice,
  updateTelemetryPreferences,
  resetTelemetryInstallationId,
  initializeTelemetry,
  shutdownTelemetry,
  captureTelemetryEvent,
  reportTelemetryError,
  durationBucket,
  markTelemetryMilestone,
  platformFamily,
  listPlugins,
  installPlugin,
  updatePlugin,
  pinPlugin,
  unpinPlugin,
  rollbackPlugin,
  uninstallPlugin,
  enablePlugin,
  disablePlugin,
  approvePluginComponent,
  setPluginProjectOverride,
  resetPluginProjectOverride,
  listMarketplaces,
  addMarketplace,
  refreshMarketplaceWithPlugins,
  removeMarketplace,
  setMarketplaceAutoUpdate,
  listMarketplacePlugins,
  inspectMarketplacePlugin,
  installMarketplacePlugin,
  type HttpServerSpec,
  type OAuthProgressEvent,
  type SyncSummary,
  type TelemetryEvent,
  type TelemetryStatus
} from "@mcpx/core";
import { IPC } from "../shared/ipc-channels";
import { ipcSchemas } from "../shared/ipc-schemas";
import type { AuthProbe, InvokeChannel, IpcArgs, IpcResult, ParsedServerInput, TokenCount, TokenCountsReport } from "../shared/ipc-contract";
import { GATEWAY_FETCH_TIMEOUT_MS } from "../shared/timeouts";
import { isClientAddCommand, looksLikeUrl, suggestNameFromCommand, suggestNameFromUrl } from "../shared/server-input";
import { openDashboard } from "./dashboard";
import { loadDesktopSettings, updateDesktopSettings } from "./settings-store";
import { applyStartOnLoginSetting } from "./login-item";
import { checkForUpdatesNow, setAutoUpdateEnabled } from "./update-manager";
import { updateTrayForDaemonStatus } from "./tray";
import { dismissPendingAuth, getPendingAuth, queuePendingAuth } from "./auth-events";
import { quitApp } from "./app-control";
import { resolveCliDaemonPath } from "./cli-path";
import { initializeDesktopErrorReporting, refreshDesktopErrorReporting } from "./error-reporting";

// ---------------------------------------------------------------------------
// Telemetry helpers (optional diagnostics must never affect an IPC operation)
// ---------------------------------------------------------------------------

function telemetryRelease(): string {
  return process.env.MCPX_SENTRY_RELEASE || "desktop";
}

function telemetryVersion(): string {
  const release = telemetryRelease();
  return release.startsWith("mcpx@") ? release.slice("mcpx@".length) : release;
}

function telemetryRuntime() {
  return { release: telemetryRelease(), platform: process.platform, architecture: process.arch };
}

type TelemetryOperation = Extract<TelemetryEvent, { name: "operation_completed" }>["properties"]["operation"];

const KNOWN_ERROR_CODES = new Set([
  "auth_required", "auth_expired", "secret_missing", "timeout", "unreachable", "upstream_error",
  "sync_error", "unexpected_error", "validation_error"
]);

function telemetryErrorCode(error: unknown): string {
  if (error instanceof Error && error.name === "OAuthCancelledError") return "auth_cancelled";
  if (error instanceof Error && error.name === "ZodError") return "validation_error";
  const candidate = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  return typeof candidate === "string" && KNOWN_ERROR_CODES.has(candidate) ? candidate : "unexpected_error";
}

function safeDurationBucket(durationMs: number): "lt_100ms" | "lt_1s" | "lt_10s" | "gte_10s" {
  try {
    return durationBucket(durationMs);
  } catch {
    if (durationMs < 100) return "lt_100ms";
    if (durationMs < 1_000) return "lt_1s";
    if (durationMs < 10_000) return "lt_10s";
    return "gte_10s";
  }
}

function safeCaptureTelemetryEvent(event: TelemetryEvent): void {
  try {
    captureTelemetryEvent(event);
  } catch {
    // ignore
  }
}

function safeMarkTelemetryMilestone(milestone: "first_server_added" | "first_sync_succeeded" | "first_gateway_request_succeeded"): void {
  try {
    markTelemetryMilestone(milestone);
  } catch {
    // ignore
  }
}

function safeReportTelemetryError(error: unknown, operation: TelemetryOperation): void {
  try {
    reportTelemetryError(error, { runtime: "desktop", operation, code: telemetryErrorCode(error) });
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Typed, validated handler registration
// ---------------------------------------------------------------------------

/** A readable validation error (zod's default message is a JSON dump). */
class IpcValidationError extends Error {
  readonly code = "validation_error";
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function parseArgs<C extends InvokeChannel>(channel: C, raw: unknown[]): IpcArgs<C> {
  const result = ipcSchemas[channel].safeParse(raw);
  if (!result.success) {
    throw new IpcValidationError(result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data as IpcArgs<C>;
}

type Handler<C extends InvokeChannel> = (...args: IpcArgs<C>) => IpcResult<C> | Promise<IpcResult<C>>;

/**
 * Registers `fn` for `channel`. Arguments are validated against the channel's
 * zod schema before `fn` runs. With `operation`, the call is also reported as
 * an anonymous operation_completed event (outcome + duration bucket only).
 */
function handle<C extends InvokeChannel>(channel: C, fn: Handler<C>, operation?: TelemetryOperation): void {
  ipcMain.handle(channel, async (_event, ...raw: unknown[]) => {
    const startedAt = Date.now();
    try {
      const result = await fn(...parseArgs(channel, raw));
      if (operation) {
        safeCaptureTelemetryEvent({
          name: "operation_completed",
          properties: { operation, outcome: "success", durationBucket: safeDurationBucket(Date.now() - startedAt) }
        });
      }
      return result;
    } catch (error) {
      if (operation) {
        safeCaptureTelemetryEvent({
          name: "operation_completed",
          properties: { operation, outcome: "failure", errorCode: telemetryErrorCode(error), durationBucket: safeDurationBucket(Date.now() - startedAt) }
        });
        safeReportTelemetryError(error, operation);
      }
      throw error;
    }
  });
}

// ---------------------------------------------------------------------------
// Shared operations
// ---------------------------------------------------------------------------

async function refreshTokenCountsSoon(): Promise<void> {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch {
    return;
  }
  const token = ensureGatewayToken(config, new SecretsManager());
  if (!token) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GATEWAY_FETCH_TIMEOUT_MS);
  try {
    await fetch(`http://127.0.0.1:${config.gateway.port}/internal/token-counts/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal
    });
  } catch {
    // Best-effort cache refresh only.
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The one post-mutation sequence: re-sync every client from the freshly
 * saved config, persist the per-client results, and nudge the gateway to
 * recount context cost in the background.
 */
async function syncAndPersist(secrets: SecretsManager = new SecretsManager()): Promise<SyncSummary> {
  const summary = syncAllClients(loadConfig(), secrets);
  await mutateConfig((freshConfig) => {
    persistSyncState(summary, freshConfig);
  });
  void refreshTokenCountsSoon();
  return summary;
}

function storeSecrets(secrets: SecretsManager, values: Record<string, string> | undefined): void {
  for (const [key, value] of Object.entries(values ?? {})) {
    // Blank means "keep the existing secret" - the renderer never sees values.
    if (value) secrets.setSecret(key, value);
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

function broadcastTelemetryStatus(status: TelemetryStatus): void {
  broadcast(IPC.TELEMETRY_CHANGED, status);
}

function openDashboardAt(route?: string): void {
  const window = openDashboard() as BrowserWindow | undefined;
  if (!route || !window || window.isDestroyed()) return;
  const send = () => {
    if (!window.isDestroyed()) window.webContents.send(IPC.NAVIGATE, route);
  };
  if (window.webContents.isLoading()) {
    window.webContents.once("did-finish-load", send);
  } else {
    send();
  }
}

function getCliDaemonPath(): string {
  return resolveCliDaemonPath(process.resourcesPath, app.getAppPath());
}

function requireServer(serverName: string) {
  const spec = loadConfig().servers[serverName];
  if (!spec) throw new Error(`Server "${serverName}" not found.`);
  return spec;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]/g, "_");
}

export function parseServerInput(input: string): ParsedServerInput {
  const trimmed = input.trim();
  if (isClientAddCommand(trimmed)) {
    try {
      const parsed = parseCliAddCommand(trimmed);
      return { kind: "client-command", name: parsed.name, spec: parsed.spec, force: parsed.force };
    } catch (error) {
      throw new Error(`Couldn't read that command: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (looksLikeUrl(trimmed)) {
    return { kind: "url", name: suggestNameFromUrl(trimmed), spec: { transport: "http", url: trimmed } };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    throw new Error("Only http:// and https:// server URLs are supported.");
  }
  const tokens = tokenizeCommandLine(trimmed);
  if (tokens.length === 0) throw new Error("Paste a URL or a command to launch the server.");
  const [command, ...args] = tokens;
  return {
    kind: "command",
    name: suggestNameFromCommand(tokens),
    spec: { transport: "stdio", command, ...(args.length > 0 ? { args } : {}) }
  };
}

let tokenCountsInFlight: Promise<TokenCountsReport> | null = null;

async function loadTokenCounts(): Promise<TokenCountsReport> {
  const config = loadMergedConfig();
  const daemon = getDaemonStatus(config);
  if (!daemon.running) {
    return { gatewayRunning: false, counts: {}, totalGlobalTokens: 0, totalProjectTokens: {} };
  }
  const report = await buildStatusReport(config, loadManagedIndex(), daemon);
  const counts: Record<string, TokenCount> = {};
  for (const server of report.servers) {
    if (server.tokenCount) counts[server.name] = server.tokenCount;
  }
  return {
    gatewayRunning: true,
    counts,
    totalGlobalTokens: report.totalGlobalTokens ?? 0,
    totalProjectTokens: report.totalProjectTokens ?? {}
  };
}

// In-flight OAuth logins, keyed by server name and shared across every window:
// a second sign-in for the same server joins the first instead of racing it.
interface InFlightOAuth {
  controller: AbortController;
  promise: Promise<{ serverName: string; authorized: true }>;
}
const inFlightOAuth = new Map<string, InFlightOAuth>();
const oauthAuthorizationUrls = new Map<string, string>();

function broadcastOAuthProgress(serverName: string, event: OAuthProgressEvent | { phase: "done" | "cancelled" | "error"; message?: string }): void {
  broadcast(IPC.OAUTH_PROGRESS, { serverName, ...event });
}

function startOAuth(serverName: string): Promise<{ serverName: string; authorized: true }> {
  const existing = inFlightOAuth.get(serverName);
  if (existing) return existing.promise;

  const spec = requireServer(serverName);
  if (spec.transport !== "http") throw new Error("Browser sign-in is only available for URL-based servers.");

  const secrets = new SecretsManager();
  const controller = new AbortController();
  const promise = (async () => {
    try {
      const result = await runOAuthLogin(
        serverName,
        spec as HttpServerSpec,
        secrets,
        (url) => { void shell.openExternal(url); },
        undefined,
        undefined,
        {
          signal: controller.signal,
          onProgress: (event) => {
            if (event.phase === "awaiting-browser") oauthAuthorizationUrls.set(serverName, event.authorizationUrl);
            broadcastOAuthProgress(serverName, event);
          }
        }
      );
      dismissPendingAuth(serverName);
      await refreshTokenCountsSoon();
      broadcastOAuthProgress(serverName, { phase: "done" });
      return result;
    } catch (error) {
      broadcastOAuthProgress(serverName, {
        phase: error instanceof Error && error.name === "OAuthCancelledError" ? "cancelled" : "error",
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      inFlightOAuth.delete(serverName);
      oauthAuthorizationUrls.delete(serverName);
    }
  })();

  inFlightOAuth.set(serverName, { controller, promise });
  return promise;
}

async function probeAuth(name: string, spec: { transport: string }, secrets: SecretsManager): Promise<AuthProbe> {
  if (spec.transport !== "http") return {};
  const probe = await probeHttpAuthRequirement(spec as HttpServerSpec, secrets);
  if (!probe.authRequired) return {};
  queuePendingAuth({ serverName: name, oauthLikely: probe.oauthLikely, oauthSupport: probe.oauthSupport, status: probe.status });
  return { authRequired: true, authStatus: probe.status, oauthLikely: probe.oauthLikely, oauthSupport: probe.oauthSupport };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerIpcHandlers(): void {
  // App + window --------------------------------------------------------------
  handle(IPC.OPEN_DASHBOARD, (request) => openDashboardAt(request?.route));
  handle(IPC.QUIT_APP, () => quitApp());

  // Status + gateway ----------------------------------------------------------
  // Fast path: never waits on the gateway's token counting (which can take up
  // to a minute). Context cost arrives separately via GET_TOKEN_COUNTS.
  handle(IPC.GET_STATUS, async () => {
    const config = loadMergedConfig();
    const daemon = getDaemonStatus(config);
    const report = await buildStatusReport(config, loadManagedIndex(), { ...daemon, running: false });
    return { ...report, daemon, totalGlobalTokens: undefined, totalProjectTokens: undefined };
  });

  handle(IPC.GET_TOKEN_COUNTS, () => {
    tokenCountsInFlight ??= loadTokenCounts().finally(() => {
      tokenCountsInFlight = null;
    });
    return tokenCountsInFlight;
  });

  handle(IPC.SYNC_ALL, async () => {
    const summary = await syncAndPersist();
    if (!summary.hasErrors) safeMarkTelemetryMilestone("first_sync_succeeded");
    return summary;
  }, "client_sync");

  handle(IPC.DAEMON_START, async () => {
    let config: ReturnType<typeof loadConfig>;
    try {
      config = loadConfig();
    } catch (err) {
      updateTrayForDaemonStatus(false);
      throw new Error(`Cannot start the gateway: ${(err as Error).message}`);
    }
    const result = await startDaemon(config, getCliDaemonPath(), new SecretsManager());
    const alreadyRunning = result.message === "mcpx daemon already running.";
    updateTrayForDaemonStatus(result.started || alreadyRunning);
    if (!result.started && !alreadyRunning) throw new Error(result.message);
    return result;
  });

  handle(IPC.DAEMON_STOP, () => {
    const result = stopDaemon();
    updateTrayForDaemonStatus(false);
    return result;
  });

  handle(IPC.DAEMON_RESTART, async () => {
    const result = await restartDaemon(loadConfig(), getCliDaemonPath(), new SecretsManager());
    updateTrayForDaemonStatus(result.started);
    if (!result.started) throw new Error(result.message);
    return result;
  });

  // Desktop settings + telemetry --------------------------------------------
  handle(IPC.GET_DESKTOP_SETTINGS, () => loadDesktopSettings());

  handle(IPC.UPDATE_DESKTOP_SETTINGS, (patch) => {
    const next = updateDesktopSettings(patch);
    if (patch.startOnLoginEnabled !== undefined) applyStartOnLoginSetting(next.startOnLoginEnabled);
    if (patch.autoUpdateEnabled !== undefined) setAutoUpdateEnabled(next.autoUpdateEnabled);
    return next;
  });

  handle(IPC.GET_TELEMETRY_STATUS, () => getTelemetryStatus());

  handle(IPC.ACKNOWLEDGE_TELEMETRY_NOTICE, async () => {
    const preferences = acknowledgeTelemetryNotice();
    initializeTelemetry("desktop", telemetryRuntime());
    await initializeDesktopErrorReporting(telemetryRelease());
    safeCaptureTelemetryEvent({
      name: "runtime_started",
      properties: { runtime: "desktop", version: telemetryVersion(), osFamily: platformFamily(), architecture: architecture(), launchMode: "desktop" }
    });
    broadcastTelemetryStatus(getTelemetryStatus());
    return preferences;
  });

  handle(IPC.UPDATE_TELEMETRY_PREFERENCES, async (patch) => {
    const next = updateTelemetryPreferences(patch);
    initializeTelemetry("desktop", telemetryRuntime());
    await refreshDesktopErrorReporting(telemetryRelease());
    broadcastTelemetryStatus(getTelemetryStatus());
    return next;
  });

  handle(IPC.RESET_TELEMETRY_ID, async () => {
    const next = resetTelemetryInstallationId();
    await shutdownTelemetry();
    initializeTelemetry("desktop", telemetryRuntime());
    broadcastTelemetryStatus(getTelemetryStatus());
    return next;
  });

  handle(IPC.CAPTURE_DESKTOP_TAB_VIEWED, (tab) => {
    safeCaptureTelemetryEvent({ name: "desktop_tab_viewed", properties: { tab } });
  });

  handle(IPC.CHECK_FOR_UPDATES, () => checkForUpdatesNow());

  // Servers -------------------------------------------------------------------
  handle(IPC.PARSE_SERVER_INPUT, (input) => parseServerInput(input));

  handle(IPC.ADD_SERVER, async ({ name, spec, secrets: secretValues, force }) => {
    const secrets = new SecretsManager();
    storeSecrets(secrets, secretValues);
    await mutateConfig((config) => {
      addServer(config, name, spec, force ?? false);
    });
    const sync = await syncAndPersist(secrets);
    const auth = await probeAuth(name, spec, secrets);
    safeMarkTelemetryMilestone("first_server_added");
    return { added: name, sync, ...auth };
  }, "server_add");

  handle(IPC.UPDATE_SERVER, async (name, spec, secretValues) => {
    const secrets = new SecretsManager();
    storeSecrets(secrets, secretValues);
    await mutateConfig((config) => {
      updateServer(config, name, spec);
    });
    return { updated: name, sync: await syncAndPersist(secrets) };
  }, "server_update");

  handle(IPC.REMOVE_SERVER, async (name) => {
    await mutateConfig((config) => {
      removeServer(config, name, false);
    });
    const secrets = new SecretsManager();
    // Otherwise a same-named re-add would silently reuse stale OAuth tokens.
    clearOAuthCredentials(name, secrets);
    dismissPendingAuth(name);
    return { removed: name, sync: await syncAndPersist(secrets) };
  }, "server_remove");

  handle(IPC.SET_SERVER_ENABLED, async (name, enabled) => {
    await mutateConfig((config) => {
      setServerEnabled(config, name, enabled);
    });
    return { updated: name, enabled, sync: await syncAndPersist() };
  }, "server_toggle");

  // Auth ----------------------------------------------------------------------
  handle(IPC.CONFIGURE_AUTH, async ({ serverName, headerName, authValue, secretName, raw }) => {
    const spec = requireServer(serverName);
    const secrets = new SecretsManager();
    const resolvedSecretName = secretName ?? `auth_${slug(serverName)}_header_${slug(headerName)}`;
    const target = resolveAuthTarget(spec, headerName);
    secrets.setSecret(resolvedSecretName, maybePrefixBearer(target, authValue, raw ?? false));
    await mutateConfig((freshConfig) => {
      const freshSpec = freshConfig.servers[serverName];
      if (!freshSpec) throw new Error(`Server "${serverName}" not found.`);
      applyAuthReference(freshSpec, target, toSecretRef(resolvedSecretName));
    });
    const sync = await syncAndPersist(secrets);
    dismissPendingAuth(serverName);
    return { configured: true as const, sync };
  }, "auth_login");

  handle(IPC.GET_PENDING_AUTH, () => getPendingAuth());

  handle(IPC.DISMISS_AUTH, (serverName) => {
    dismissPendingAuth(serverName);
    return { dismissed: serverName };
  });

  // From the popover: surface sign-in in the dashboard, which owns the full flow.
  handle(IPC.REQUEST_AUTH, (serverName) => {
    requireServer(serverName);
    if (!getPendingAuth().some((entry) => entry.serverName === serverName)) {
      queuePendingAuth({ serverName });
    }
    openDashboardAt(`servers:auth:${serverName}`);
    return { opened: true as const };
  });

  handle(IPC.CHECK_OAUTH_SUPPORT, async (serverName) => {
    const spec = requireServer(serverName);
    if (spec.transport !== "http") {
      return { support: "unsupported" as const, resourceMetadata: false, authorizationServerMetadata: false };
    }
    return probeOAuthSupport(spec.url);
  });

  handle(IPC.START_OAUTH, (serverName) => startOAuth(serverName), "auth_login");

  handle(IPC.CANCEL_OAUTH, (serverName) => {
    const entry = inFlightOAuth.get(serverName);
    entry?.controller.abort();
    return { cancelled: Boolean(entry) };
  });

  handle(IPC.OAUTH_REOPEN, (serverName) => {
    const url = oauthAuthorizationUrls.get(serverName);
    if (url) void shell.openExternal(url);
    return { reopened: Boolean(url) };
  });

  // Projects ------------------------------------------------------------------
  handle(IPC.PROJECT_INIT, async (projectPath, name) => {
    await mutateConfig((config) => {
      registerProject(config, projectPath, name);
    });
    return { success: true as const, sync: await syncAndPersist() };
  }, "project_init");

  handle(IPC.PROJECT_REMOVE, async (projectPath) => {
    await mutateConfig((config) => {
      unregisterProject(config, projectPath);
    });
    return { success: true as const, sync: await syncAndPersist() };
  }, "project_remove");

  handle(IPC.PROJECT_SET_SERVER_ENABLED, async (projectPath, serverName, enabled) => {
    const result = await mutateConfig((config) => setProjectServerEnabled(config, projectPath, serverName, enabled));
    const sync = await syncAndPersist();
    return { updated: serverName, projectPath, enabled, sync, effective: result?.effective, reason: result?.reason };
  }, "server_toggle");

  handle(IPC.SELECT_DIRECTORY, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"], title: "Choose a folder" });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });

  // Skills --------------------------------------------------------------------
  handle(IPC.LIST_SKILLS, () => listSkills());

  handle(IPC.SAVE_SKILL, async (id, content) => {
    saveSkill(id, content);
    await syncAndPersist();
    return { id, success: true as const };
  }, "skill_add");

  handle(IPC.DELETE_SKILL, async (id) => {
    deleteSkill(id);
    await syncAndPersist();
    return { id, success: true as const };
  }, "skill_remove");

  handle(IPC.INSTALL_SKILL, async (source, skill) => {
    const installed = await installSkillFromSource(source, skill);
    await syncAndPersist();
    return installed;
  });

  handle(IPC.CUSTOMIZE_SKILL, async (id, name) => {
    const customized = customizeSkill(id, name);
    await syncAndPersist();
    return customized;
  });

  handle(IPC.PIN_SKILL, (id) => {
    pinSkill(id);
    return { id, success: true as const };
  });

  handle(IPC.UNPIN_SKILL, (id) => {
    unpinSkill(id);
    return { id, success: true as const };
  });

  handle(IPC.UPDATE_SKILL, async (id) => {
    const result = await updateSkill(id);
    await syncAndPersist();
    return result;
  });

  handle(IPC.ROLLBACK_SKILL, async (id) => {
    const result = rollbackSkill(id);
    await syncAndPersist();
    return result;
  });

  // Environment sharing -------------------------------------------------------
  handle(IPC.SHARE_EXPORT, (directory, options) => exportEnvironment(directory, options));

  handle(IPC.SHARE_IMPORT, async (directory, options) => {
    const result = await importEnvironment(directory, options);
    if (!options?.dryRun) await syncAndPersist();
    return result;
  });

  // Plugins -------------------------------------------------------------------
  const ok = <T extends object>(value: T) => ({ ...value, success: true as const });

  handle(IPC.PLUGIN_LIST, () => listPlugins());
  handle(IPC.PLUGIN_INSTALL, (source) => installPlugin(source), "plugin_install");
  handle(IPC.PLUGIN_UPDATE, (id) => updatePlugin(id), "plugin_update");
  handle(IPC.PLUGIN_PIN, async (id) => { await pinPlugin(id); return ok({ name: id }); });
  handle(IPC.PLUGIN_UNPIN, async (id) => { await unpinPlugin(id); return ok({ name: id }); });
  handle(IPC.PLUGIN_ROLLBACK, (id) => rollbackPlugin(id));
  handle(IPC.PLUGIN_UNINSTALL, async (id, keepData) => { await uninstallPlugin(id, keepData); return ok({ name: id }); }, "plugin_uninstall");
  handle(IPC.PLUGIN_ENABLE, async (id) => { await enablePlugin(id); return ok({ name: id }); }, "plugin_toggle");
  handle(IPC.PLUGIN_DISABLE, async (id) => { await disablePlugin(id); return ok({ name: id }); }, "plugin_toggle");
  handle(IPC.PLUGIN_APPROVE, async (id, component) => { await approvePluginComponent(id, component); return ok({ name: id, component }); });
  handle(IPC.PLUGIN_SET_PROJECT_OVERRIDE, async (id, projectPath, override) => {
    await setPluginProjectOverride(id, projectPath, override);
    return ok({ name: id, projectPath });
  });
  handle(IPC.PLUGIN_RESET_PROJECT_OVERRIDE, async (id, projectPath) => {
    await resetPluginProjectOverride(id, projectPath);
    return ok({ name: id, projectPath });
  });

  // Marketplaces --------------------------------------------------------------
  handle(IPC.MARKETPLACE_LIST, () => listMarketplaces());
  handle(IPC.MARKETPLACE_ADD, (source) => addMarketplace(source), "marketplace_add");
  handle(IPC.MARKETPLACE_REFRESH, (name) => refreshMarketplaceWithPlugins(name), "marketplace_refresh");
  handle(IPC.MARKETPLACE_REMOVE, async (name) => { await removeMarketplace(name); return ok({ name }); }, "marketplace_remove");
  handle(IPC.MARKETPLACE_SET_AUTO_UPDATE, (name, enabled) => setMarketplaceAutoUpdate(name, enabled));
  handle(IPC.MARKETPLACE_BROWSE, (query) => listMarketplacePlugins(query));
  handle(IPC.MARKETPLACE_INSPECT_PLUGIN, (id) => inspectMarketplacePlugin(id));
  handle(IPC.MARKETPLACE_INSTALL_PLUGIN, (id) => installMarketplacePlugin(id), "plugin_install");
}
