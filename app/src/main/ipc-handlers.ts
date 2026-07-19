import { app, ipcMain, dialog, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
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
  SecretsManager,
  buildStatusReport,
  loadManagedIndex,
  probeHttpAuthRequirement,
  applyAuthReference,
  resolveAuthTarget,
  toSecretRef,
  maybePrefixBearer,
  parseCliAddCommand,
  tokenizeCommandLine,
  runOAuthLogin,
  ensureGatewayToken
} from "@mcpx/core";
import type { HttpServerSpec, StdioServerSpec, UpstreamServerSpec } from "@mcpx/core";
import { IPC } from "../shared/ipc-channels";
import type { DesktopSettingsPatch } from "../shared/desktop-settings";
import { GATEWAY_FETCH_TIMEOUT_MS } from "../shared/timeouts";
import { openDashboard } from "./dashboard";
import { loadDesktopSettings, updateDesktopSettings } from "./settings-store";
import { applyStartOnLoginSetting } from "./login-item";
import { checkForUpdatesNow, setAutoUpdateEnabled } from "./update-manager";
import { updateTrayForDaemonStatus } from "./tray";
import { dismissPendingAuth, getPendingAuth, queuePendingAuth } from "./auth-events";
import { quitApp } from "./app-control";

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
    await fetch(`http://127.0.0.1:${config.gateway.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "refresh-token-counts",
        method: "custom/refreshTokenCounts",
        params: {}
      }),
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

function getCliDaemonPath(): string {
  const resourcesPath = process.resourcesPath ?? app.getAppPath();
  const cliPath = path.join(resourcesPath, "cli", "dist", "cli.js");
  if (fs.existsSync(cliPath)) {
    return cliPath;
  }
  // Fallback for development
  return path.join(app.getAppPath(), "..", "cli", "dist", "cli.js");
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

  ipcMain.handle(IPC.UPDATE_DESKTOP_SETTINGS, (_event, patch: DesktopSettingsPatch) => {
    const next = updateDesktopSettings(patch);
    applyStartOnLoginSetting(next.startOnLoginEnabled);
    setAutoUpdateEnabled(next.autoUpdateEnabled);
    return next;
  });

  ipcMain.handle(IPC.CHECK_FOR_UPDATES, async () => {
    return checkForUpdatesNow();
  });

  ipcMain.handle(IPC.ADD_SERVER, async (_event, name: string, spec: UpstreamServerSpec) => {
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

    const result: { added: string; sync: typeof summary; authRequired?: boolean; authStatus?: number; oauthLikely?: boolean } = { added: name, sync: summary };

    if (spec.transport === "http") {
      const probe = await probeHttpAuthRequirement(spec, secrets);
      if (probe.authRequired) {
        result.authRequired = true;
        result.authStatus = probe.status;
        result.oauthLikely = probe.oauthLikely;
        queuePendingAuth({ serverName: name, oauthLikely: probe.oauthLikely, status: probe.status });
      }
    }

    return result;
  });

  ipcMain.handle(IPC.CONFIGURE_AUTH, async (_event, { serverName, headerName, authValue, secretName, raw }: { serverName: string; headerName: string; authValue: string; secretName?: string; raw?: boolean }) => {
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
    dismissPendingAuth(serverName);
    return { dismissed: serverName };
  });

  ipcMain.handle(IPC.START_OAUTH, async (_event, serverName: string) => {
    const config = loadConfig();
    const spec = config.servers[serverName];
    if (!spec) {
      throw new Error(`Server "${serverName}" not found.`);
    }
    if (spec.transport !== "http") {
      throw new Error("OAuth login only supports HTTP servers.");
    }

    const secrets = new SecretsManager();
    const result = await runOAuthLogin(
      serverName,
      spec as HttpServerSpec,
      secrets,
      (url) => { void shell.openExternal(url); },
    );
    dismissPendingAuth(serverName);
    await refreshTokenCountsSoon();
    return result;
  });

  ipcMain.handle(IPC.REMOVE_SERVER, async (_event, name: string) => {
    await mutateConfig((config) => {
      removeServer(config, name, false);
    });
    const secrets = new SecretsManager();
    const config = loadConfig();
    const summary = syncAllClients(config, secrets);
    await mutateConfig((freshConfig) => {
      persistSyncState(summary, freshConfig);
    });
    queueTokenCountRefresh();
    return { removed: name, sync: summary };
  });

  ipcMain.handle(IPC.SET_SERVER_ENABLED, async (_event, name: string, enabled: boolean) => {
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

  ipcMain.handle(IPC.PROJECT_SET_SERVER_ENABLED, async (_event, projectPath: string, serverName: string, enabled: boolean) => {
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

  ipcMain.handle(IPC.UPDATE_SERVER, async (_event, name: string, spec: UpstreamServerSpec, resolvedSecrets?: Record<string, string>) => {
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
        const headers = { ...(spec.headers ?? {}) };
        headers[key] = `secret://${secretName}`;
        spec.headers = Object.keys(headers).length > 0 ? headers : undefined;
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

  ipcMain.handle(IPC.SYNC_ALL, async () => {
    const config = loadConfig();
    const secrets = new SecretsManager();
    const summary = syncAllClients(config, secrets);
    await mutateConfig((freshConfig) => {
      persistSyncState(summary, freshConfig);
    });
    queueTokenCountRefresh();
    return summary;
  });

  ipcMain.handle(IPC.PROJECT_INIT, async (_event, projectPath: string, name: string) => {
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

  ipcMain.handle(IPC.PROJECT_REMOVE, async (_event, projectPath: string) => {
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
    updateTrayForDaemonStatus(result.started);
    if (!result.started) {
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
    updateTrayForDaemonStatus(true);
    return result;
  });

  ipcMain.handle(IPC.EXECUTE_CLI_COMMAND, async (_event, command: string) => {
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

    const result: { added: string; sync: typeof summary; authRequired?: boolean; authStatus?: number; oauthLikely?: boolean } = { added: name, sync: summary };

    if (spec.transport === "http") {
      const probe = await probeHttpAuthRequirement(spec, secrets);
      if (probe.authRequired) {
        result.authRequired = true;
        result.authStatus = probe.status;
        result.oauthLikely = probe.oauthLikely;
        queuePendingAuth({ serverName: name, oauthLikely: probe.oauthLikely, status: probe.status });
      }
    }

    return result;
  });

  // Skills
  ipcMain.handle(IPC.LIST_SKILLS, () => {
    return listSkills();
  });

  ipcMain.handle(IPC.GET_SKILL, (_event, id: string) => {
    return getSkill(id);
  });

  ipcMain.handle(IPC.SAVE_SKILL, (_event, id: string, content: string) => {
    saveSkill(id, content);
    return { id, success: true };
  });

  ipcMain.handle(IPC.DELETE_SKILL, (_event, id: string) => {
    deleteSkill(id);
    return { id, success: true };
  });

  // Plugin Management
  ipcMain.handle(IPC.PLUGIN_INSPECT, async (_event, source: string) => {
    const { inspectPlugin } = await import("@mcpx/core");
    return inspectPlugin(source);
  });

  ipcMain.handle(IPC.PLUGIN_INSTALL, async (_event, source: string, options?: unknown) => {
    const { installPlugin } = await import("@mcpx/core");
    return installPlugin(source, options as any);
  });

  ipcMain.handle(IPC.PLUGIN_PREPARE, async (_event, name: string) => {
    const { preparePlugin } = await import("@mcpx/core");
    await preparePlugin(name);
    return { name, success: true };
  });

  ipcMain.handle(IPC.PLUGIN_UPDATE, async (_event, name: string) => {
    const { updatePlugin } = await import("@mcpx/core");
    return updatePlugin(name);
  });

  ipcMain.handle(IPC.PLUGIN_UNINSTALL, async (_event, name: string, options?: unknown) => {
    const { uninstallPlugin } = await import("@mcpx/core");
    await uninstallPlugin(name, options as any);
    return { name, success: true };
  });

  ipcMain.handle(IPC.PLUGIN_ENABLE, async (_event, name: string) => {
    const { enablePlugin } = await import("@mcpx/core");
    await enablePlugin(name);
    return { name, success: true };
  });

  ipcMain.handle(IPC.PLUGIN_DISABLE, async (_event, name: string) => {
    const { disablePlugin } = await import("@mcpx/core");
    await disablePlugin(name);
    return { name, success: true };
  });

  ipcMain.handle(IPC.PLUGIN_SET_PROJECT_OVERRIDE, async (_event, name: string, projectPath: string, override: { enabled?: boolean; components?: Partial<Record<string, boolean>> }) => {
    const { setPluginProjectOverride } = await import("@mcpx/core");
    await setPluginProjectOverride(name, projectPath, override);
    return { name, projectPath, override, success: true };
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
}
