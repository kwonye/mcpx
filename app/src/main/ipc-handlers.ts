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
  getSkill,
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
  type TelemetryEvent,
  type TelemetryStatus
} from "@mcpx/core";
import type { HttpServerSpec, StdioServerSpec, UpstreamServerSpec, OAuthProgressEvent } from "@mcpx/core";
import { z } from "zod";
import { IPC } from "../shared/ipc-channels";
import type { DesktopSettingsPatch } from "../shared/desktop-settings";
import { GATEWAY_FETCH_TIMEOUT_MS } from "../shared/timeouts";

const serverNameSchema = z.string().trim().min(1, "Server name must be non-empty");
const headerNameSchema = z.string().trim().min(1);
const authValueSchema = z.string().min(1);
import { openDashboard } from "./dashboard";
import { loadDesktopSettings, updateDesktopSettings } from "./settings-store";
import { applyStartOnLoginSetting } from "./login-item";
import { checkForUpdatesNow, setAutoUpdateEnabled } from "./update-manager";
import { updateTrayForDaemonStatus } from "./tray";
import { dismissPendingAuth, getPendingAuth, queuePendingAuth } from "./auth-events";
import { quitApp } from "./app-control";
import { resolveCliDaemonPath } from "./cli-path";
import { initializeDesktopErrorReporting, refreshDesktopErrorReporting } from "./error-reporting";

function telemetryRelease(): string {
  return process.env.MCPX_SENTRY_RELEASE || "desktop";
}

function telemetryVersion(): string {
  const release = telemetryRelease();
  return release.startsWith("mcpx@") ? release.slice("mcpx@".length) : release;
}

type TelemetryOperation = Extract<TelemetryEvent, { name: "operation_completed" }>["properties"]["operation"];

function telemetryErrorCode(error: unknown): string {
  if (error instanceof Error && error.name === "OAuthCancelledError") return "auth_cancelled";
  if (error instanceof Error && error.name === "ZodError") return "validation_error";
  const candidate = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  if (typeof candidate === "string" && [
    "auth_required", "auth_expired", "secret_missing", "timeout", "unreachable", "upstream_error",
    "sync_error", "unexpected_error", "validation_error"
  ].includes(candidate)) {
    return candidate;
  }
  return "unexpected_error";
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
    // Optional diagnostics must never affect an IPC operation or its tests.
  }
}

function safeMarkTelemetryMilestone(milestone: "first_server_added" | "first_sync_succeeded" | "first_gateway_request_succeeded"): void {
  try {
    markTelemetryMilestone(milestone);
  } catch {
    // Optional diagnostics must never affect an IPC operation.
  }
}

function safeReportTelemetryError(error: unknown, operation: TelemetryOperation): void {
  try {
    reportTelemetryError(error, {
      runtime: "desktop",
      operation,
      code: telemetryErrorCode(error)
    });
  } catch {
    // Optional diagnostics must never affect an IPC operation or its tests.
  }
}

function registerTelemetryHandler(
  channel: string,
  operation: TelemetryOperation,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    const startedAt = Date.now();
    try {
      const result = await handler(event, ...args);
      safeCaptureTelemetryEvent({
        name: "operation_completed",
        properties: { operation, outcome: "success", durationBucket: safeDurationBucket(Date.now() - startedAt) }
      });
      return result;
    } catch (error) {
      safeCaptureTelemetryEvent({
        name: "operation_completed",
        properties: { operation, outcome: "failure", errorCode: telemetryErrorCode(error), durationBucket: safeDurationBucket(Date.now() - startedAt) }
      });
      safeReportTelemetryError(error, operation);
      throw error;
    }
  });
}

async function refreshTokenCountsSoon(): Promise<void> {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch {
    return;
  }
  const secrets = new SecretsManager();
  const token = ensureGatewayToken(config, secrets);
  if (!token) {
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GATEWAY_FETCH_TIMEOUT_MS);
  try {
    await fetch(`http://127.0.0.1:${config.gateway.port}/internal/token-counts/refresh`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      signal: controller.signal
    });
  } catch {
    // Best-effort cache refresh only.
  } finally {
    clearTimeout(timeout);
  }
}

function queueTokenCountRefresh(): void {
  void refreshTokenCountsSoon();
}

function broadcastTelemetryStatus(status: TelemetryStatus): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC.TELEMETRY_CHANGED, status);
    }
  }
}

function getCliDaemonPath(): string {
  return resolveCliDaemonPath(process.resourcesPath, app.getAppPath());
}

function normalizeUpdatedSpec(spec: UpstreamServerSpec): UpstreamServerSpec {
  if (spec.transport !== "stdio") {
    return spec;
  }

  const parts = tokenizeCommandLine(spec.command);
  if (parts.length <= 1) {
    return parts[0] ? { ...spec, command: parts[0] } : spec;
  }

  const [command, ...args] = parts;
  return {
    ...spec,
    command,
    args: [...args, ...(spec.args ?? [])]
  };
}

// In-flight OAuth logins, keyed by server name. Shared across every window in
// this process: if the dashboard and the popover both trigger sign-in for the
// same server, the second call joins the first instead of racing it (the
// cross-process file lock in runOAuthLogin is the last-resort net for two
// separate mcpx processes; within one process this dedup is what actually
// gives a good user experience -- an error rather than a shared flow).
interface InFlightOAuth {
  controller: AbortController;
  promise: Promise<{ serverName: string; authorized: true }>;
}
const inFlightOAuth = new Map<string, InFlightOAuth>();
const oauthAuthorizationUrls = new Map<string, string>();

function broadcastOAuthProgress(serverName: string, event: OAuthProgressEvent | { phase: "done" | "cancelled" | "error"; message?: string }): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue;
    }
    window.webContents.send(IPC.OAUTH_PROGRESS, { serverName, ...event });
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.OPEN_DASHBOARD, () => {
    openDashboard();
  });

  ipcMain.handle(IPC.QUIT_APP, () => {
    quitApp();
  });

  ipcMain.handle(IPC.GET_STATUS, async () => {
    const config = loadMergedConfig();
    const managedIndex = loadManagedIndex();
    return await buildStatusReport(config, managedIndex);
  });

  ipcMain.handle(IPC.GET_SERVERS, () => {
    const config = loadMergedConfig();
    return Object.entries(config.servers).map(([name, spec]) => ({ name, ...spec }));
  });

  ipcMain.handle(IPC.GET_DESKTOP_SETTINGS, () => {
    return loadDesktopSettings();
  });

  ipcMain.handle(IPC.GET_TELEMETRY_STATUS, () => getTelemetryStatus());

  ipcMain.handle(IPC.ACKNOWLEDGE_TELEMETRY_NOTICE, async () => {
    const preferences = acknowledgeTelemetryNotice();
    initializeTelemetry("desktop", { release: telemetryRelease(), platform: process.platform, architecture: process.arch });
    await initializeDesktopErrorReporting(telemetryRelease());
    safeCaptureTelemetryEvent({
      name: "runtime_started",
      properties: {
        runtime: "desktop",
        version: telemetryVersion(),
        osFamily: platformFamily(),
        architecture: architecture(),
        launchMode: "desktop"
      }
    });
    broadcastTelemetryStatus(getTelemetryStatus());
    return preferences;
  });

  ipcMain.handle(IPC.UPDATE_DESKTOP_SETTINGS, (_event, patch: DesktopSettingsPatch) => {
    const next = updateDesktopSettings(patch);
    if (patch.startOnLoginEnabled !== undefined) applyStartOnLoginSetting(next.startOnLoginEnabled);
    if (patch.autoUpdateEnabled !== undefined) setAutoUpdateEnabled(next.autoUpdateEnabled);
    return next;
  });

  ipcMain.handle(IPC.UPDATE_TELEMETRY_PREFERENCES, async (_event, patch: { usageAnalyticsEnabled?: boolean; errorReportingEnabled?: boolean }) => {
    const safePatch = z.object({
      usageAnalyticsEnabled: z.boolean().optional(),
      errorReportingEnabled: z.boolean().optional()
    }).parse(patch);
    const next = updateTelemetryPreferences(safePatch);
    initializeTelemetry("desktop", { release: telemetryRelease(), platform: process.platform, architecture: process.arch });
    await refreshDesktopErrorReporting(telemetryRelease());
    broadcastTelemetryStatus(getTelemetryStatus());
    return next;
  });

  ipcMain.handle(IPC.RESET_TELEMETRY_ID, async () => {
    const next = resetTelemetryInstallationId();
    await shutdownTelemetry();
    initializeTelemetry("desktop", { release: telemetryRelease(), platform: process.platform, architecture: process.arch });
    broadcastTelemetryStatus(getTelemetryStatus());
    return next;
  });

  ipcMain.handle(IPC.CAPTURE_DESKTOP_TAB_VIEWED, (_event, tab: string) => {
    const safeTab = z.enum(["servers", "projects", "plugins", "settings"]).parse(tab);
    safeCaptureTelemetryEvent({ name: "desktop_tab_viewed", properties: { tab: safeTab } });
  });

  ipcMain.handle(IPC.CHECK_FOR_UPDATES, async () => {
    return checkForUpdatesNow();
  });

  registerTelemetryHandler(IPC.ADD_SERVER, "server_add", async (_event, name: string, spec: UpstreamServerSpec) => {
    serverNameSchema.parse(name);
    if (!spec || typeof spec !== "object" || !("transport" in spec)) throw new Error("Invalid server spec");
    await mutateConfig((config) => {
      addServer(config, name, spec, true);
    });
    const secrets = new SecretsManager();
    const config = loadConfig();
    const summary = syncAllClients(config, secrets);
    await mutateConfig((freshConfig) => {
      persistSyncState(summary, freshConfig);
    });
    queueTokenCountRefresh();

    const result: { added: string; sync: typeof summary; authRequired?: boolean; authStatus?: number; oauthLikely?: boolean; oauthSupport?: string } = { added: name, sync: summary };

    if (spec.transport === "http") {
      const probe = await probeHttpAuthRequirement(spec, secrets);
      if (probe.authRequired) {
        result.authRequired = true;
        result.authStatus = probe.status;
        result.oauthLikely = probe.oauthLikely;
        result.oauthSupport = probe.oauthSupport;
        queuePendingAuth({ serverName: name, oauthLikely: probe.oauthLikely, oauthSupport: probe.oauthSupport, status: probe.status });
      }
    }

    safeMarkTelemetryMilestone("first_server_added");
    return result;
  });

  registerTelemetryHandler(IPC.CONFIGURE_AUTH, "auth_login", async (_event, { serverName, headerName, authValue, secretName, raw }: { serverName: string; headerName: string; authValue: string; secretName?: string; raw?: boolean }) => {
    serverNameSchema.parse(serverName);
    headerNameSchema.parse(headerName);
    authValueSchema.parse(authValue);
    if (secretName !== undefined) z.string().min(1).parse(secretName);
    const config = loadConfig();
    const spec = config.servers[serverName];
    if (!spec) throw new Error(`Server "${serverName}" not found`);

    const secrets = new SecretsManager();
    const resolvedSecretName = secretName ?? `auth_${serverName.toLowerCase().replace(/[^a-z0-9._-]/g, "_")}_header_${headerName.toLowerCase().replace(/[^a-z0-9._-]/g, "_")}`;
    const target = resolveAuthTarget(spec, headerName);
    const finalValue = maybePrefixBearer(target, authValue, raw ?? false);
    secrets.setSecret(resolvedSecretName, finalValue);

    await mutateConfig((freshConfig) => {
      const freshSpec = freshConfig.servers[serverName];
      if (!freshSpec) throw new Error(`Server "${serverName}" not found`);
      applyAuthReference(freshSpec, target, toSecretRef(resolvedSecretName));
    });

    const syncSourceConfig = loadConfig();
    const summary = syncAllClients(syncSourceConfig, secrets);
    await mutateConfig((freshConfig) => {
      persistSyncState(summary, freshConfig);
    });
    queueTokenCountRefresh();

    dismissPendingAuth(serverName);
    return { configured: true, sync: summary };
  });

  ipcMain.handle(IPC.GET_PENDING_AUTH, () => {
    return getPendingAuth();
  });

  ipcMain.handle(IPC.DISMISS_AUTH, (_event, serverName: string) => {
    serverNameSchema.parse(serverName);
    dismissPendingAuth(serverName);
    return { dismissed: serverName };
  });

  ipcMain.handle(IPC.REQUEST_AUTH, (_event, serverName: string) => {
    serverNameSchema.parse(serverName);
    const config = loadConfig();
    if (!config.servers[serverName]) {
      throw new Error(`Server "${serverName}" not found.`);
    }
    if (!getPendingAuth().some((entry) => entry.serverName === serverName)) {
      queuePendingAuth({ serverName });
    }
    openDashboard();
    return { opened: true };
  });

  ipcMain.handle(IPC.CHECK_OAUTH_SUPPORT, async (_event, serverName: string) => {
    serverNameSchema.parse(serverName);
    const config = loadConfig();
    const spec = config.servers[serverName];
    if (!spec) {
      throw new Error(`Server "${serverName}" not found.`);
    }
    if (spec.transport !== "http") {
      return { support: "unsupported" as const, resourceMetadata: false, authorizationServerMetadata: false };
    }
    return probeOAuthSupport(spec.url);
  });

  registerTelemetryHandler(IPC.START_OAUTH, "auth_login", async (_event, serverName: string) => {
    serverNameSchema.parse(serverName);
    const existing = inFlightOAuth.get(serverName);
    if (existing) {
      return existing.promise;
    }

    const config = loadConfig();
    const spec = config.servers[serverName];
    if (!spec) {
      throw new Error(`Server "${serverName}" not found.`);
    }
    if (spec.transport !== "http") {
      throw new Error("OAuth login only supports HTTP servers.");
    }

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
              if (event.phase === "awaiting-browser") {
                oauthAuthorizationUrls.set(serverName, event.authorizationUrl);
              }
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
  });

  ipcMain.handle(IPC.CANCEL_OAUTH, (_event, serverName: string) => {
    serverNameSchema.parse(serverName);
    const entry = inFlightOAuth.get(serverName);
    entry?.controller.abort();
    return { cancelled: Boolean(entry) };
  });

  ipcMain.handle(IPC.OAUTH_REOPEN, (_event, serverName: string) => {
    serverNameSchema.parse(serverName);
    const url = oauthAuthorizationUrls.get(serverName);
    if (url) {
      void shell.openExternal(url);
    }
    return { reopened: Boolean(url) };
  });

  registerTelemetryHandler(IPC.REMOVE_SERVER, "server_remove", async (_event, name: string) => {
    serverNameSchema.parse(name);
    await mutateConfig((config) => {
      removeServer(config, name, false);
    });
    const secrets = new SecretsManager();
    // Otherwise a later same-named re-add would silently reuse stale OAuth
    // tokens/client registration left behind by the removed server.
    clearOAuthCredentials(name, secrets);
    const config = loadConfig();
    const summary = syncAllClients(config, secrets);
    await mutateConfig((freshConfig) => {
      persistSyncState(summary, freshConfig);
    });
    queueTokenCountRefresh();
    return { removed: name, sync: summary };
  });

  registerTelemetryHandler(IPC.SET_SERVER_ENABLED, "server_toggle", async (_event, name: string, enabled: boolean) => {
    serverNameSchema.parse(name);
    z.boolean().parse(enabled);
    await mutateConfig((config) => {
      setServerEnabled(config, name, enabled);
    });
    const secrets = new SecretsManager();
    const config = loadConfig();
    const summary = syncAllClients(config, secrets);
    await mutateConfig((freshConfig) => {
      persistSyncState(summary, freshConfig);
    });
    queueTokenCountRefresh();
    return { updated: name, enabled, sync: summary };
  });

  registerTelemetryHandler(IPC.PROJECT_SET_SERVER_ENABLED, "server_toggle", async (_event, projectPath: string, serverName: string, enabled: boolean) => {
    const result = await mutateConfig((config) => {
      return setProjectServerEnabled(config, projectPath, serverName, enabled);
    });
    const secrets = new SecretsManager();
    const config = loadConfig();
    const summary = syncAllClients(config, secrets);
    await mutateConfig((freshConfig) => {
      persistSyncState(summary, freshConfig);
    });
    queueTokenCountRefresh();
    return { updated: serverName, projectPath, enabled, sync: summary, effective: result.effective, reason: result.reason };
  });

  registerTelemetryHandler(IPC.UPDATE_SERVER, "server_update", async (_event, name: string, spec: UpstreamServerSpec, resolvedSecrets?: Record<string, string>) => {
    serverNameSchema.parse(name);
    if (!spec || typeof spec !== "object" || !("transport" in spec)) throw new Error("Invalid server spec");
    const secrets = new SecretsManager();
    
    // Store any new secret values before updating the server
    if (resolvedSecrets) {
      for (const [key, value] of Object.entries(resolvedSecrets)) {
        if (value) {
          secrets.setSecret(key, value);
        }
      }
    }

    spec = normalizeUpdatedSpec(spec);

    // Auto-migrate plain-text values that look like secrets but weren't marked
    const secretKeyPattern = /^(api.?key|token|secret|password|auth.?token|access.?key|service.?role.?key)/i;
    const entries = spec.transport === "http"
      ? Object.entries(spec.headers ?? {}).map(([k, v]) => ["header" as const, k, v] as const)
      : Object.entries((spec as StdioServerSpec).env ?? {}).map(([k, v]) => ["env" as const, k, v] as const);

    for (const [kind, key, value] of entries) {
      if (!value || value.startsWith("secret://")) continue;
      if (!secretKeyPattern.test(key.replace(/[_-]/g, "."))) continue;

      const secretName = `auth_${name.toLowerCase().replace(/[^a-z0-9._-]/g, "_")}_${kind}_${key.toLowerCase().replace(/[^a-z0-9._-]/g, "_")}`;
      if (!secrets.getSecret(secretName)) {
        secrets.setSecret(secretName, value);
      }

      if (kind === "header") {
        const headers = { ...((spec as HttpServerSpec).headers ?? {}) };
        headers[key] = `secret://${secretName}`;
        (spec as HttpServerSpec).headers = Object.keys(headers).length > 0 ? headers : undefined;
      } else {
        const env = { ...((spec as StdioServerSpec).env ?? {}) };
        env[key] = `secret://${secretName}`;
        (spec as StdioServerSpec).env = Object.keys(env).length > 0 ? env : undefined;
      }
    }
    
    await mutateConfig((config) => {
      updateServer(config, name, spec);
    });
    const config = loadConfig();
    const summary = syncAllClients(config, secrets);
    await mutateConfig((freshConfig) => {
      persistSyncState(summary, freshConfig);
    });
    queueTokenCountRefresh();
    return { updated: name, sync: summary };
  });

  registerTelemetryHandler(IPC.SYNC_ALL, "client_sync", async () => {
    const config = loadConfig();
    const secrets = new SecretsManager();
    const summary = syncAllClients(config, secrets);
    await mutateConfig((freshConfig) => {
      persistSyncState(summary, freshConfig);
    });
    queueTokenCountRefresh();
    if (!summary.hasErrors) safeMarkTelemetryMilestone("first_sync_succeeded");
    return summary;
  });

  registerTelemetryHandler(IPC.PROJECT_INIT, "project_init", async (_event, projectPath: string, name: string) => {
    await mutateConfig((config) => {
      registerProject(config, projectPath, name);
    });

    const secrets = new SecretsManager();
    const config = loadConfig();
    const summary = syncAllClients(config, secrets);
    await mutateConfig((freshConfig) => {
      persistSyncState(summary, freshConfig);
    });
    queueTokenCountRefresh();
    return { success: true, sync: summary };
  });

  registerTelemetryHandler(IPC.PROJECT_REMOVE, "project_remove", async (_event, projectPath: string) => {
    await mutateConfig((config) => {
      unregisterProject(config, projectPath);
    });

    const secrets = new SecretsManager();
    const config = loadConfig();
    const summary = syncAllClients(config, secrets);
    await mutateConfig((freshConfig) => {
      persistSyncState(summary, freshConfig);
    });
    queueTokenCountRefresh();
    return { success: true, sync: summary };
  });

  ipcMain.handle(IPC.SELECT_DIRECTORY, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select Project Directory"
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle(IPC.DAEMON_START, async () => {
    let config: ReturnType<typeof loadConfig>;
    try {
      config = loadConfig();
    } catch (err) {
      updateTrayForDaemonStatus(false);
      throw new Error(`Cannot start daemon: ${(err as Error).message}`);
    }
    const secrets = new SecretsManager();
    const result = await startDaemon(config, getCliDaemonPath(), secrets);
    const alreadyRunning = result.message === "mcpx daemon already running.";
    updateTrayForDaemonStatus(result.started || alreadyRunning);
    if (!result.started && !alreadyRunning) {
      throw new Error(result.message);
    }
    return result;
  });

  ipcMain.handle(IPC.DAEMON_STOP, () => {
    const result = stopDaemon();
    updateTrayForDaemonStatus(false);
    return result;
  });

  ipcMain.handle(IPC.DAEMON_RESTART, async () => {
    const config = loadConfig();
    const secrets = new SecretsManager();
    const result = await restartDaemon(config, getCliDaemonPath(), secrets);
    updateTrayForDaemonStatus(result.started);
    if (!result.started) throw new Error(result.message);
    return result;
  });

  registerTelemetryHandler(IPC.EXECUTE_CLI_COMMAND, "server_add", async (_event, command: string) => {
    let parsed: ReturnType<typeof parseCliAddCommand>;
    try {
      parsed = parseCliAddCommand(command);
    } catch (error) {
      throw new Error(`Failed to parse command: ${error instanceof Error ? error.message : String(error)}`);
    }
    const { name, spec } = parsed;
    await mutateConfig((config) => {
      addServer(config, name, spec, true);
    });
    const secrets = new SecretsManager();
    const config = loadConfig();
    const summary = syncAllClients(config, secrets);
    await mutateConfig((freshConfig) => {
      persistSyncState(summary, freshConfig);
    });
    queueTokenCountRefresh();

    const result: { added: string; sync: typeof summary; authRequired?: boolean; authStatus?: number; oauthLikely?: boolean; oauthSupport?: string } = { added: name, sync: summary };

    if (spec.transport === "http") {
      const probe = await probeHttpAuthRequirement(spec, secrets);
      if (probe.authRequired) {
        result.authRequired = true;
        result.authStatus = probe.status;
        result.oauthLikely = probe.oauthLikely;
        result.oauthSupport = probe.oauthSupport;
        queuePendingAuth({ serverName: name, oauthLikely: probe.oauthLikely, oauthSupport: probe.oauthSupport, status: probe.status });
      }
    }

    safeMarkTelemetryMilestone("first_server_added");
    return result;
  });

  // Skills
  ipcMain.handle(IPC.LIST_SKILLS, () => {
    return listSkills();
  });

  ipcMain.handle(IPC.GET_SKILL, (_event, id: string) => {
    return getSkill(id);
  });

  registerTelemetryHandler(IPC.SAVE_SKILL, "skill_add", async (_event, id: string, content: string) => {
    saveSkill(id, content);
    const config = loadConfig();
    const summary = syncAllClients(config, new SecretsManager());
    await mutateConfig((freshConfig) => persistSyncState(summary, freshConfig));
    return { id, success: true };
  });

  registerTelemetryHandler(IPC.DELETE_SKILL, "skill_remove", async (_event, id: string) => {
    deleteSkill(id);
    const config = loadConfig();
    const summary = syncAllClients(config, new SecretsManager());
    await mutateConfig((freshConfig) => persistSyncState(summary, freshConfig));
    return { id, success: true };
  });

  ipcMain.handle(IPC.INSTALL_SKILL, async (_event, source: string, skill?: string) => {
    const installed = await installSkillFromSource(source, skill);
    const summary = syncAllClients(loadConfig(), new SecretsManager());
    await mutateConfig((freshConfig) => persistSyncState(summary, freshConfig));
    return installed;
  });

  ipcMain.handle(IPC.CUSTOMIZE_SKILL, async (_event, id: string, name?: string) => {
    const customized = customizeSkill(id, name);
    const summary = syncAllClients(loadConfig(), new SecretsManager());
    await mutateConfig((freshConfig) => persistSyncState(summary, freshConfig));
    return customized;
  });

  ipcMain.handle(IPC.PIN_SKILL, (_event, id: string) => { pinSkill(id); return { id, success: true }; });
  ipcMain.handle(IPC.UNPIN_SKILL, (_event, id: string) => { unpinSkill(id); return { id, success: true }; });
  ipcMain.handle(IPC.UPDATE_SKILL, async (_event, id: string) => {
    const result = await updateSkill(id);
    const summary = syncAllClients(loadConfig(), new SecretsManager());
    await mutateConfig((freshConfig) => persistSyncState(summary, freshConfig));
    return result;
  });
  ipcMain.handle(IPC.ROLLBACK_SKILL, async (_event, id: string) => {
    const result = rollbackSkill(id);
    const summary = syncAllClients(loadConfig(), new SecretsManager());
    await mutateConfig((freshConfig) => persistSyncState(summary, freshConfig));
    return result;
  });

  ipcMain.handle(IPC.SHARE_EXPORT, (_event, directory: string, options?: { skills?: string[]; plugins?: string[] }) => {
    return exportEnvironment(directory, options);
  });

  ipcMain.handle(IPC.SHARE_IMPORT, async (_event, directory: string, options?: { locked?: boolean; dryRun?: boolean; inputs?: Record<string, string> }) => {
    const result = await importEnvironment(directory, options);
    if (!options?.dryRun) {
      const summary = syncAllClients(loadConfig(), new SecretsManager());
      await mutateConfig((freshConfig) => persistSyncState(summary, freshConfig));
    }
    return result;
  });

  // Plugin Management
  ipcMain.handle(IPC.PLUGIN_INSPECT, async (_event, source: string) => {
    const { inspectPlugin } = await import("@mcpx/core");
    return inspectPlugin(source);
  });

  registerTelemetryHandler(IPC.PLUGIN_INSTALL, "plugin_install", async (_event, source: string, options?: unknown) => {
    const { installPlugin } = await import("@mcpx/core");
    return installPlugin(source, options as any);
  });

  ipcMain.handle(IPC.PLUGIN_PREPARE, async (_event, name: string) => {
    const { preparePlugin } = await import("@mcpx/core");
    await preparePlugin(name);
    return { name, success: true };
  });

  registerTelemetryHandler(IPC.PLUGIN_UPDATE, "plugin_update", async (_event, name: string) => {
    const { updatePlugin } = await import("@mcpx/core");
    return updatePlugin(name);
  });

  ipcMain.handle(IPC.PLUGIN_PIN, async (_event, name: string) => {
    const { pinPlugin } = await import("@mcpx/core");
    await pinPlugin(name);
    return { name, success: true };
  });
  ipcMain.handle(IPC.PLUGIN_UNPIN, async (_event, name: string) => {
    const { unpinPlugin } = await import("@mcpx/core");
    await unpinPlugin(name);
    return { name, success: true };
  });
  ipcMain.handle(IPC.PLUGIN_ROLLBACK, async (_event, name: string) => {
    const { rollbackPlugin } = await import("@mcpx/core");
    return rollbackPlugin(name);
  });

  registerTelemetryHandler(IPC.PLUGIN_UNINSTALL, "plugin_uninstall", async (_event, name: string, options?: unknown) => {
    const { uninstallPlugin } = await import("@mcpx/core");
    await uninstallPlugin(name, options as any);
    return { name, success: true };
  });

  registerTelemetryHandler(IPC.PLUGIN_ENABLE, "plugin_toggle", async (_event, name: string) => {
    const { enablePlugin } = await import("@mcpx/core");
    await enablePlugin(name);
    return { name, success: true };
  });

  registerTelemetryHandler(IPC.PLUGIN_DISABLE, "plugin_toggle", async (_event, name: string) => {
    const { disablePlugin } = await import("@mcpx/core");
    await disablePlugin(name);
    return { name, success: true };
  });

  ipcMain.handle(IPC.PLUGIN_SET_PROJECT_OVERRIDE, async (_event, name: string, projectPath: string, override: { enabled?: boolean; components?: Partial<Record<string, boolean>> }) => {
    const { setPluginProjectOverride } = await import("@mcpx/core");
    await setPluginProjectOverride(name, projectPath, override);
    return { name, projectPath, override, success: true };
  });

  ipcMain.handle(IPC.PLUGIN_RESET_PROJECT_OVERRIDE, async (_event, name: string, projectPath: string) => {
    const { resetPluginProjectOverride } = await import("@mcpx/core");
    await resetPluginProjectOverride(name, projectPath);
    return { name, projectPath, success: true };
  });

  ipcMain.handle(IPC.PLUGIN_APPROVE, async (_event, name: string, component: string) => {
    const { approvePluginComponent } = await import("@mcpx/core");
    await approvePluginComponent(name, component);
    return { name, component, success: true };
  });

  ipcMain.handle(IPC.PLUGIN_STATUS, async (_event, name?: string) => {
    const { getPluginStatus } = await import("@mcpx/core");
    return getPluginStatus(name);
  });

  ipcMain.handle(IPC.PLUGIN_LIST, async () => {
    const { listPlugins } = await import("@mcpx/core");
    return listPlugins();
  });

  ipcMain.handle(IPC.PLUGIN_CONFIG_SET, async (_event, name: string, key: string, value: string, projectPath?: string) => {
    const { pluginConfigSet } = await import("@mcpx/core");
    await pluginConfigSet(name, key, value, projectPath);
    return { name, key, value, success: true };
  });

  ipcMain.handle(IPC.PLUGIN_SYNC, async () => {
    const { pluginSync } = await import("@mcpx/core");
    await pluginSync();
    return { success: true };
  });

  ipcMain.handle(IPC.MARKETPLACE_LIST, async () => {
    const { listMarketplaces } = await import("@mcpx/core");
    return listMarketplaces();
  });

  registerTelemetryHandler(IPC.MARKETPLACE_ADD, "marketplace_add", async (_event, source: string, manifestPath?: string) => {
    const { addMarketplace } = await import("@mcpx/core");
    return addMarketplace(source, manifestPath);
  });

  registerTelemetryHandler(IPC.MARKETPLACE_REFRESH, "marketplace_refresh", async (_event, name: string) => {
    const { refreshMarketplaceWithPlugins } = await import("@mcpx/core");
    return refreshMarketplaceWithPlugins(name);
  });

  registerTelemetryHandler(IPC.MARKETPLACE_REMOVE, "marketplace_remove", async (_event, name: string) => {
    const { removeMarketplace } = await import("@mcpx/core");
    await removeMarketplace(name);
    return { name, success: true };
  });

  ipcMain.handle(IPC.MARKETPLACE_SET_AUTO_UPDATE, async (_event, name: string, enabled: boolean) => {
    const { setMarketplaceAutoUpdate } = await import("@mcpx/core");
    return setMarketplaceAutoUpdate(name, enabled);
  });

  ipcMain.handle(IPC.MARKETPLACE_BROWSE, async (_event, query?: string) => {
    const { listMarketplacePlugins } = await import("@mcpx/core");
    return listMarketplacePlugins(query);
  });

  ipcMain.handle(IPC.MARKETPLACE_INSPECT_PLUGIN, async (_event, id: string) => {
    const { inspectMarketplacePlugin } = await import("@mcpx/core");
    return inspectMarketplacePlugin(id);
  });

  ipcMain.handle(IPC.MARKETPLACE_INSTALL_PLUGIN, async (_event, id: string) => {
    const { installMarketplacePlugin } = await import("@mcpx/core");
    return installMarketplacePlugin(id);
  });
}
