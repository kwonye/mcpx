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
  synchronizeClients,
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
  defaultAuthSecretName,
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
import { controlRequest, ensureControlService, subscribeControlEvents } from "@mcpx/core";
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


let useControlService = false;
const controlMethods: Record<string, string> = {
  [IPC.ADD_SERVER]: "server.add", [IPC.UPDATE_SERVER]: "server.update",
  [IPC.REMOVE_SERVER]: "server.remove", [IPC.SET_SERVER_ENABLED]: "server.enabled", [IPC.CONFIGURE_AUTH]: "auth.configure",
  [IPC.PROJECT_SET_SERVER_ENABLED]: "project.enabled", [IPC.PROJECT_INIT]: "project.add", [IPC.PROJECT_REMOVE]: "project.remove",
  [IPC.SYNC_ALL]: "sync", [IPC.EXECUTE_CLI_COMMAND]: "server.command",
  [IPC.SAVE_SKILL]: "skill.save", [IPC.DELETE_SKILL]: "skill.delete", [IPC.INSTALL_SKILL]: "skill.install", [IPC.CUSTOMIZE_SKILL]: "skill.customize",
  [IPC.PIN_SKILL]: "skill.pin", [IPC.UNPIN_SKILL]: "skill.unpin", [IPC.UPDATE_SKILL]: "skill.update", [IPC.ROLLBACK_SKILL]: "skill.rollback",
  [IPC.PLUGIN_INSTALL]: "plugin.install", [IPC.PLUGIN_PREPARE]: "plugin.prepare", [IPC.PLUGIN_UPDATE]: "plugin.update", [IPC.PLUGIN_PIN]: "plugin.pin", [IPC.PLUGIN_UNPIN]: "plugin.unpin", [IPC.PLUGIN_ROLLBACK]: "plugin.rollback", [IPC.PLUGIN_UNINSTALL]: "plugin.uninstall", [IPC.PLUGIN_ENABLE]: "plugin.enable", [IPC.PLUGIN_DISABLE]: "plugin.disable", [IPC.PLUGIN_SET_PROJECT_OVERRIDE]: "plugin.project", [IPC.PLUGIN_RESET_PROJECT_OVERRIDE]: "plugin.resetProject", [IPC.PLUGIN_APPROVE]: "plugin.approve", [IPC.PLUGIN_CONFIG_SET]: "plugin.config", [IPC.PLUGIN_SYNC]: "plugin.sync",
  [IPC.MARKETPLACE_ADD]: "marketplace.add", [IPC.MARKETPLACE_REFRESH]: "marketplace.refresh", [IPC.MARKETPLACE_REMOVE]: "marketplace.remove", [IPC.MARKETPLACE_SET_AUTO_UPDATE]: "marketplace.automatic", [IPC.MARKETPLACE_INSTALL_PLUGIN]: "marketplace.install", [IPC.SHARE_IMPORT]: "share.import",
};
function registerHandler(channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any): void {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!useControlService) return handler(event, ...args);
    const method = controlMethods[channel];
    if (method) {
      await ensureControlService(getCliDaemonPath());
      const result = await controlRequest<any>(method, args);
      if (result?.authRequired && result.added) queuePendingAuth({ serverName: result.added, oauthLikely: result.oauthLikely, oauthSupport: result.oauthSupport, status: result.authStatus });
      if (channel === IPC.CONFIGURE_AUTH) dismissPendingAuth(args[0].serverName);
      if (method !== "status") queueTokenCountRefresh();
      return result;
    }
    // The browser authorization UX stays in Electron, under a daemon-owned writer lease.
    if (channel === IPC.START_OAUTH) {
      await ensureControlService(getCliDaemonPath());
      const lease = await controlRequest<string>("lease.acquire", [process.pid, "OAuth login"]);
      let succeeded = false;
      try { const result = await handler(event, ...args); succeeded = true; return result; }
      finally { await controlRequest("lease.release", [lease, succeeded]); }
    }
    return handler(event, ...args);
  });
}

function registerTelemetryHandler(
  channel: string,
  operation: TelemetryOperation,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any
): void {
  registerHandler(channel, async (event, ...args) => {
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

export function registerIpcHandlers(options: { controlService?: boolean } = {}): void {
  // Embedded hosts may retain the in-process bridge during migration.
  useControlService = options.controlService ?? false;
  registerHandler(IPC.MANAGEMENT_COMMAND, async (_event, method: string, args: unknown[] = []) => {
    z.enum(["snapshot", "adoption.plan", "adoption.apply", "operation.rollback", "harness.mode", "package.pin", "sync", "server.enabled"]).parse(method);
    z.array(z.unknown()).parse(args);
    if (method !== "snapshot") await ensureControlService(getCliDaemonPath());
    return controlRequest(method, args);
  });
  if (useControlService) {
    let unsubscribe: (() => void) | undefined;
    let initial = true;
    let stopped = false;
    const connect = async () => {
      if (stopped) return;
      try {
        if (initial) { initial = false; if (loadConfig().gateway.autoStart) await ensureControlService(getCliDaemonPath()); }
        unsubscribe?.();
        unsubscribe = subscribeControlEvents(event => {
          for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IPC.MANAGEMENT_EVENT, event);
        }, () => { setTimeout(() => { void connect(); }, 2000).unref(); });
      } catch { setTimeout(() => { void connect(); }, 2000).unref(); }
    };
    void connect();
    app.once("before-quit", () => { stopped = true; unsubscribe?.(); });
  }
  registerHandler(IPC.OPEN_DASHBOARD, () => {
    openDashboard();
  });

  registerHandler(IPC.QUIT_APP, () => {
    quitApp();
  });

  registerHandler(IPC.GET_STATUS, async () => {
    const config = loadMergedConfig();
    const managedIndex = loadManagedIndex();
    return await buildStatusReport(config, managedIndex);
  });

  registerHandler(IPC.GET_SERVERS, () => {
    const config = loadMergedConfig();
    return Object.entries(config.servers).map(([name, spec]) => ({ name, ...spec }));
  });

  registerHandler(IPC.GET_DESKTOP_SETTINGS, () => {
    return loadDesktopSettings();
  });

  registerHandler(IPC.GET_TELEMETRY_STATUS, () => getTelemetryStatus());

  registerHandler(IPC.ACKNOWLEDGE_TELEMETRY_NOTICE, async () => {
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

  registerHandler(IPC.UPDATE_DESKTOP_SETTINGS, (_event, patch: DesktopSettingsPatch) => {
    const next = updateDesktopSettings(patch);
    if (patch.startOnLoginEnabled !== undefined) applyStartOnLoginSetting(next.startOnLoginEnabled);
    if (patch.autoUpdateEnabled !== undefined) setAutoUpdateEnabled(next.autoUpdateEnabled);
    return next;
  });

  registerHandler(IPC.UPDATE_TELEMETRY_PREFERENCES, async (_event, patch: { usageAnalyticsEnabled?: boolean; errorReportingEnabled?: boolean }) => {
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

  registerHandler(IPC.RESET_TELEMETRY_ID, async () => {
    const next = resetTelemetryInstallationId();
    await shutdownTelemetry();
    initializeTelemetry("desktop", { release: telemetryRelease(), platform: process.platform, architecture: process.arch });
    broadcastTelemetryStatus(getTelemetryStatus());
    return next;
  });

  registerHandler(IPC.CAPTURE_DESKTOP_TAB_VIEWED, (_event, tab: string) => {
    const safeTab = z.enum(["servers", "projects", "plugins", "settings"]).parse(tab);
    safeCaptureTelemetryEvent({ name: "desktop_tab_viewed", properties: { tab: safeTab } });
  });

  registerHandler(IPC.CHECK_FOR_UPDATES, async () => {
    return checkForUpdatesNow();
  });

  registerTelemetryHandler(IPC.ADD_SERVER, "server_add", async (_event, name: string, spec: UpstreamServerSpec) => {
    serverNameSchema.parse(name);
    if (!spec || typeof spec !== "object" || !("transport" in spec)) throw new Error("Invalid server spec");
    await mutateConfig((config) => {
      addServer(config, name, spec, true);
    });
    const secrets = new SecretsManager();
    const summary = await synchronizeClients({}, secrets);
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

  registerTelemetryHandler(IPC.CONFIGURE_AUTH, "auth_login", async (_event, { serverName, headerName, envName, authValue, secretName, raw }: { serverName: string; headerName?: string; envName?: string; authValue: string; secretName?: string; raw?: boolean }) => {
    serverNameSchema.parse(serverName);
    if (headerName !== undefined) headerNameSchema.parse(headerName);
    if (envName !== undefined) z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).parse(envName);
    authValueSchema.parse(authValue);
    if (secretName !== undefined) z.string().min(1).parse(secretName);
    const config = loadConfig();
    const spec = config.servers[serverName];
    if (!spec) throw new Error(`Server "${serverName}" not found`);

    const secrets = new SecretsManager();
    const target = resolveAuthTarget(spec, headerName, envName);
    const resolvedSecretName = secretName ?? defaultAuthSecretName(serverName, target);
    const finalValue = maybePrefixBearer(target, authValue, raw ?? false);
    secrets.setSecret(resolvedSecretName, finalValue);

    await mutateConfig((freshConfig) => {
      const freshSpec = freshConfig.servers[serverName];
      if (!freshSpec) throw new Error(`Server "${serverName}" not found`);
      applyAuthReference(freshSpec, target, toSecretRef(resolvedSecretName));
    });

    const summary = await synchronizeClients({}, secrets);
    queueTokenCountRefresh();

    dismissPendingAuth(serverName);
    return { configured: true, sync: summary };
  });

  registerHandler(IPC.GET_PENDING_AUTH, () => {
    return getPendingAuth();
  });

  registerHandler(IPC.DISMISS_AUTH, (_event, serverName: string) => {
    serverNameSchema.parse(serverName);
    dismissPendingAuth(serverName);
    return { dismissed: serverName };
  });

  registerHandler(IPC.REQUEST_AUTH, (_event, serverName: string) => {
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

  registerHandler(IPC.CHECK_OAUTH_SUPPORT, async (_event, serverName: string) => {
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

  registerHandler(IPC.CANCEL_OAUTH, (_event, serverName: string) => {
    serverNameSchema.parse(serverName);
    const entry = inFlightOAuth.get(serverName);
    entry?.controller.abort();
    return { cancelled: Boolean(entry) };
  });

  registerHandler(IPC.OAUTH_REOPEN, (_event, serverName: string) => {
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
    const summary = await synchronizeClients({}, secrets);
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
    const summary = await synchronizeClients({}, secrets);
    queueTokenCountRefresh();
    return { updated: name, enabled, sync: summary };
  });

  registerTelemetryHandler(IPC.PROJECT_SET_SERVER_ENABLED, "server_toggle", async (_event, projectPath: string, serverName: string, enabled: boolean) => {
    const result = await mutateConfig((config) => {
      return setProjectServerEnabled(config, projectPath, serverName, enabled);
    });
    const secrets = new SecretsManager();
    const summary = await synchronizeClients({}, secrets);
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
    const summary = await synchronizeClients({}, secrets);
    queueTokenCountRefresh();
    return { updated: name, sync: summary };
  });

  registerTelemetryHandler(IPC.SYNC_ALL, "client_sync", async () => {
    const secrets = new SecretsManager();
    const summary = await synchronizeClients({}, secrets);
    queueTokenCountRefresh();
    if (!summary.hasErrors) safeMarkTelemetryMilestone("first_sync_succeeded");
    return summary;
  });

  registerTelemetryHandler(IPC.PROJECT_INIT, "project_init", async (_event, projectPath: string, name: string) => {
    await mutateConfig((config) => {
      registerProject(config, projectPath, name);
    });

    const secrets = new SecretsManager();
    const summary = await synchronizeClients({}, secrets);
    queueTokenCountRefresh();
    return { success: true, sync: summary };
  });

  registerTelemetryHandler(IPC.PROJECT_REMOVE, "project_remove", async (_event, projectPath: string) => {
    await mutateConfig((config) => {
      unregisterProject(config, projectPath);
    });

    const secrets = new SecretsManager();
    const summary = await synchronizeClients({}, secrets);
    queueTokenCountRefresh();
    return { success: true, sync: summary };
  });

  registerHandler(IPC.SELECT_DIRECTORY, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select Project Directory"
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  registerHandler(IPC.DAEMON_START, async () => {
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

  registerHandler(IPC.DAEMON_STOP, async () => {
    const result = await stopDaemon();
    updateTrayForDaemonStatus(false);
    return result;
  });

  registerHandler(IPC.DAEMON_RESTART, async () => {
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
    const summary = await synchronizeClients({}, secrets);
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
  registerHandler(IPC.LIST_SKILLS, () => {
    return listSkills();
  });

  registerHandler(IPC.GET_SKILL, (_event, id: string) => {
    return getSkill(id);
  });

  registerTelemetryHandler(IPC.SAVE_SKILL, "skill_add", async (_event, id: string, content: string) => {
    saveSkill(id, content);
    await synchronizeClients();
    return { id, success: true };
  });

  registerTelemetryHandler(IPC.DELETE_SKILL, "skill_remove", async (_event, id: string) => {
    deleteSkill(id);
    await synchronizeClients();
    return { id, success: true };
  });

  registerHandler(IPC.INSTALL_SKILL, async (_event, source: string, skill?: string) => {
    const installed = await installSkillFromSource(source, skill);
    await synchronizeClients();
    return installed;
  });

  registerHandler(IPC.CUSTOMIZE_SKILL, async (_event, id: string, name?: string) => {
    const customized = customizeSkill(id, name);
    await synchronizeClients();
    return customized;
  });

  registerHandler(IPC.PIN_SKILL, (_event, id: string) => { pinSkill(id); return { id, success: true }; });
  registerHandler(IPC.UNPIN_SKILL, (_event, id: string) => { unpinSkill(id); return { id, success: true }; });
  registerHandler(IPC.UPDATE_SKILL, async (_event, id: string) => {
    const result = await updateSkill(id);
    await synchronizeClients();
    return result;
  });
  registerHandler(IPC.ROLLBACK_SKILL, async (_event, id: string) => {
    const result = rollbackSkill(id);
    await synchronizeClients();
    return result;
  });

  registerHandler(IPC.SHARE_EXPORT, (_event, directory: string, options?: { skills?: string[]; plugins?: string[] }) => {
    return exportEnvironment(directory, options);
  });

  registerHandler(IPC.SHARE_IMPORT, async (_event, directory: string, options?: { locked?: boolean; dryRun?: boolean; inputs?: Record<string, string> }) => {
    const result = await importEnvironment(directory, options);
    if (!options?.dryRun) {
      await synchronizeClients();
    }
    return result;
  });

  // Plugin Management
  registerHandler(IPC.PLUGIN_INSPECT, async (_event, source: string) => {
    const { inspectPlugin } = await import("@mcpx/core");
    return inspectPlugin(source);
  });

  registerTelemetryHandler(IPC.PLUGIN_INSTALL, "plugin_install", async (_event, source: string, options?: unknown) => {
    const { installPlugin } = await import("@mcpx/core");
    return installPlugin(source, options as any);
  });

  registerHandler(IPC.PLUGIN_PREPARE, async (_event, name: string) => {
    const { preparePlugin } = await import("@mcpx/core");
    await preparePlugin(name);
    return { name, success: true };
  });

  registerTelemetryHandler(IPC.PLUGIN_UPDATE, "plugin_update", async (_event, name: string) => {
    const { updatePlugin } = await import("@mcpx/core");
    return updatePlugin(name);
  });

  registerHandler(IPC.PLUGIN_PIN, async (_event, name: string) => {
    const { pinPlugin } = await import("@mcpx/core");
    await pinPlugin(name);
    return { name, success: true };
  });
  registerHandler(IPC.PLUGIN_UNPIN, async (_event, name: string) => {
    const { unpinPlugin } = await import("@mcpx/core");
    await unpinPlugin(name);
    return { name, success: true };
  });
  registerHandler(IPC.PLUGIN_ROLLBACK, async (_event, name: string) => {
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

  registerHandler(IPC.PLUGIN_SET_PROJECT_OVERRIDE, async (_event, name: string, projectPath: string, override: { enabled?: boolean; components?: Partial<Record<string, boolean>> }) => {
    const { setPluginProjectOverride } = await import("@mcpx/core");
    await setPluginProjectOverride(name, projectPath, override);
    return { name, projectPath, override, success: true };
  });

  registerHandler(IPC.PLUGIN_RESET_PROJECT_OVERRIDE, async (_event, name: string, projectPath: string) => {
    const { resetPluginProjectOverride } = await import("@mcpx/core");
    await resetPluginProjectOverride(name, projectPath);
    return { name, projectPath, success: true };
  });

  registerHandler(IPC.PLUGIN_APPROVE, async (_event, name: string, component: string) => {
    const { approvePluginComponent } = await import("@mcpx/core");
    await approvePluginComponent(name, component);
    return { name, component, success: true };
  });

  registerHandler(IPC.PLUGIN_STATUS, async (_event, name?: string) => {
    const { getPluginStatus } = await import("@mcpx/core");
    return getPluginStatus(name);
  });

  registerHandler(IPC.PLUGIN_LIST, async () => {
    const { listPlugins } = await import("@mcpx/core");
    return listPlugins();
  });

  registerHandler(IPC.PLUGIN_CONFIG_SET, async (_event, name: string, key: string, value: string, projectPath?: string) => {
    const { pluginConfigSet } = await import("@mcpx/core");
    await pluginConfigSet(name, key, value, projectPath);
    return { name, key, value, success: true };
  });

  registerHandler(IPC.PLUGIN_SYNC, async () => {
    const { pluginSync } = await import("@mcpx/core");
    await pluginSync();
    return { success: true };
  });

  registerHandler(IPC.MARKETPLACE_LIST, async () => {
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

  registerHandler(IPC.MARKETPLACE_SET_AUTO_UPDATE, async (_event, name: string, enabled: boolean) => {
    const { setMarketplaceAutoUpdate } = await import("@mcpx/core");
    return setMarketplaceAutoUpdate(name, enabled);
  });

  registerHandler(IPC.MARKETPLACE_BROWSE, async (_event, query?: string) => {
    const { listMarketplacePlugins } = await import("@mcpx/core");
    return listMarketplacePlugins(query);
  });

  registerHandler(IPC.MARKETPLACE_INSPECT_PLUGIN, async (_event, id: string) => {
    const { inspectMarketplacePlugin } = await import("@mcpx/core");
    return inspectMarketplacePlugin(id);
  });

  registerHandler(IPC.MARKETPLACE_INSTALL_PLUGIN, async (_event, id: string) => {
    const { installMarketplacePlugin } = await import("@mcpx/core");
    return installMarketplacePlugin(id);
  });
}
