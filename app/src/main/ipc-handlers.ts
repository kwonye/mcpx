import { app, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  loadConfig,
  saveConfig,
  getDaemonStatus,
  startDaemon,
  stopDaemon,
  restartDaemon,
  syncAllClients,
  addServer,
  removeServer,
  setServerEnabled,
  updateServer,
  listAuthBindings,
  SecretsManager,
  buildStatusReport,
  loadManagedIndex
} from "@mcpx/core";
import type { UpstreamServerSpec } from "@mcpx/core";
import { IPC } from "../shared/ipc-channels";
import type { DesktopSettingsPatch } from "../shared/desktop-settings";
import { openDashboard } from "./dashboard";
import { fetchRegistryServers, fetchServerDetail } from "./registry-client";
import { selectBestPackage, extractRequiredInputs, mapServerToSpec } from "./server-mapper";
import type { SelectedOption } from "./server-mapper";
import { loadDesktopSettings, updateDesktopSettings } from "./settings-store";
import { applyStartOnLoginSetting } from "./login-item";
import { checkForUpdatesNow, setAutoUpdateEnabled } from "./update-manager";

// Cache the selected option between prepare and confirm calls
let pendingAdd: { name: string; option: SelectedOption } | null = null;

function getCliDaemonPath(): string {
  const resourcesPath = process.resourcesPath ?? app.getAppPath();
  const cliPath = path.join(resourcesPath, "cli", "dist", "cli.js");
  if (fs.existsSync(cliPath)) {
    return cliPath;
  }
  // Fallback for development
  return path.join(app.getAppPath(), "..", "cli", "dist", "cli.js");
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function parseKeyValueFlag(value: string, label: string): [string, string] {
  const split = value.indexOf("=");
  if (split <= 0 || split >= value.length - 1) {
    throw new Error(`Invalid ${label} format: ${value}. Use KEY=VALUE.`);
  }
  return [value.slice(0, split), value.slice(split + 1)];
}

function parseCliAddCommand(command: string): { name: string; spec: UpstreamServerSpec } {
  // Remove leading "mcpx" and trim
  let trimmed = command.trim();
  if (trimmed.startsWith("mcpx ")) {
    trimmed = trimmed.slice(5).trim();
  }
  
  // Handle client-native commands (claude mcp add, codex mcp add, qwen mcp add, code --add-mcp)
  const parts = trimmed.split(/\s+/);
  
  // Check for client-native patterns
  if (parts[0] === "claude" && parts[1] === "mcp" && parts[2] === "add") {
    // Claude: claude mcp add <name> <url|command> [options]
    return parseClaudeAdd(parts.slice(3));
  }
  
  if (parts[0] === "codex" && parts[1] === "mcp" && parts[2] === "add") {
    // Codex: codex mcp add <name> [--env KEY=VALUE] -- <command> [args...]
    return parseCodexAdd(parts.slice(3));
  }
  
  if (parts[0] === "qwen" && parts[1] === "mcp" && parts[2] === "add") {
    // Qwen: qwen mcp add <name> <url|command> [options]
    return parseQwenAdd(parts.slice(3));
  }
  
  if (parts[0] === "code" && parts[1] === "--add-mcp") {
    // VS Code: code --add-mcp '<json>'
    return parseVSCodeAdd(parts[2]);
  }
  
  // Standard mcpx add command
  if (parts[0] === "add") {
    return parseStandardAdd(parts.slice(1));
  }
  
  // Assume it's a standard add command without "add" prefix
  return parseStandardAdd(parts);
}

function parseStandardAdd(args: string[]): { name: string; spec: UpstreamServerSpec } {
  const header: string[] = [];
  const env: string[] = [];
  let cwd: string | undefined;
  const values: string[] = [];
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--transport") {
      i++; // Skip next value
    } else if (arg === "--header") {
      header.push(args[++i]);
    } else if (arg === "--env") {
      env.push(args[++i]);
    } else if (arg === "--cwd") {
      cwd = args[++i];
    } else if (arg === "--force") {
      // Skip
    } else {
      values.push(arg);
    }
  }
  
  return buildServerSpec(values, { header, env, cwd });
}

function parseClaudeAdd(args: string[]): { name: string; spec: UpstreamServerSpec } {
  const header: string[] = [];
  const env: string[] = [];
  let cwd: string | undefined;
  const values: string[] = [];
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--header") {
      header.push(args[++i]);
    } else if (arg === "--env") {
      env.push(args[++i]);
    } else if (arg === "--cwd") {
      cwd = args[++i];
    } else if (arg === "--transport" || arg === "--scope") {
      i++; // Skip
    } else {
      values.push(arg);
    }
  }
  
  return buildServerSpec(values, { header, env, cwd });
}

function parseCodexAdd(args: string[]): { name: string; spec: UpstreamServerSpec } {
  const header: string[] = [];
  const env: string[] = [];
  let cwd: string | undefined;
  const values: string[] = [];
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--env") {
      env.push(args[++i]);
    } else if (arg === "--") {
      // Rest is command
      values.push(...args.slice(i + 1));
      break;
    } else {
      values.push(arg);
    }
  }
  
  return buildServerSpec(values, { header, env, cwd });
}

function parseQwenAdd(args: string[]): { name: string; spec: UpstreamServerSpec } {
  const header: string[] = [];
  const env: string[] = [];
  let cwd: string | undefined;
  const values: string[] = [];
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--header") {
      header.push(args[++i]);
    } else if (arg === "--env") {
      env.push(args[++i]);
    } else if (arg === "--cwd") {
      cwd = args[++i];
    } else if (arg === "--transport" || arg === "--scope" || arg === "--trust" || arg === "--include-tools" || arg === "--exclude-tools" || arg === "--timeout") {
      i++; // Skip
    } else {
      values.push(arg);
    }
  }
  
  return buildServerSpec(values, { header, env, cwd });
}

function parseVSCodeAdd(jsonPayload: string): { name: string; spec: UpstreamServerSpec } {
  if (!jsonPayload) {
    throw new Error("Missing JSON payload for --add-mcp");
  }
  
  const payload = JSON.parse(jsonPayload);
  const name = payload.name;
  
  if (!name) {
    throw new Error("Missing 'name' in JSON payload");
  }
  
  if (payload.url) {
    return {
      name,
      spec: {
        transport: "http",
        url: payload.url,
        headers: payload.headers
      }
    };
  }
  
  if (payload.command) {
    return {
      name,
      spec: {
        transport: "stdio",
        command: payload.command,
        args: payload.args,
        env: payload.env,
        cwd: payload.cwd
      }
    };
  }
  
  throw new Error("JSON payload must include 'url' or 'command'");
}

function buildServerSpec(
  values: string[],
  options: { header: string[]; env: string[]; cwd?: string }
): { name: string; spec: UpstreamServerSpec } {
  if (values.length < 2) {
    throw new Error("Usage: add [--transport auto|http|stdio] <name> <url|command> [args...]");
  }

  const name = values[0] ?? "";
  const target = values[1] ?? "";
  const trailing = values.slice(2);
  const transport = isHttpUrl(target) && trailing.length === 0 ? "http" : "stdio";

  if (transport === "http") {
    if (values.length !== 2) {
      throw new Error("HTTP upstream usage: add <name> --transport http <url>");
    }
    if (!isHttpUrl(target)) {
      throw new Error(`Invalid HTTP URL: ${target}`);
    }
    if (options.env.length > 0 || options.cwd) {
      throw new Error("--env/--cwd are only valid for stdio transport.");
    }

    const headers: Record<string, string> = {};
    for (const item of options.header) {
      const [key, value] = parseKeyValueFlag(item, "header");
      headers[key] = value;
    }

    const spec: UpstreamServerSpec = {
      transport: "http",
      url: target,
      headers: Object.keys(headers).length > 0 ? headers : undefined
    };

    return { name, spec };
  }

  if (options.header.length > 0) {
    throw new Error("--header is only valid for HTTP transport.");
  }

  const env: Record<string, string> = {};
  for (const item of options.env) {
    const [key, value] = parseKeyValueFlag(item, "env");
    env[key] = value;
  }

  const spec: UpstreamServerSpec = {
    transport: "stdio",
    command: target,
    args: trailing.length > 0 ? trailing : undefined,
    env: Object.keys(env).length > 0 ? env : undefined,
    cwd: options.cwd
  };

  return { name, spec };
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.OPEN_DASHBOARD, () => {
    openDashboard();
  });

  ipcMain.handle(IPC.GET_STATUS, () => {
    const config = loadConfig();
    const managedIndex = loadManagedIndex();
    return buildStatusReport(config, managedIndex);
  });

  ipcMain.handle(IPC.GET_SERVERS, () => {
    const config = loadConfig();
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

  ipcMain.handle(IPC.ADD_SERVER, (_event, name: string, spec: UpstreamServerSpec) => {
    const config = loadConfig();
    addServer(config, name, spec, true);
    saveConfig(config);
    const secrets = new SecretsManager();
    const summary = syncAllClients(config, secrets);
    return { added: name, sync: summary };
  });

  ipcMain.handle(IPC.REMOVE_SERVER, (_event, name: string) => {
    const config = loadConfig();
    removeServer(config, name, false);
    saveConfig(config);
    const secrets = new SecretsManager();
    const summary = syncAllClients(config, secrets);
    return { removed: name, sync: summary };
  });

  ipcMain.handle(IPC.SET_SERVER_ENABLED, (_event, name: string, enabled: boolean) => {
    const config = loadConfig();
    setServerEnabled(config, name, enabled);
    saveConfig(config);
    const secrets = new SecretsManager();
    const summary = syncAllClients(config, secrets);
    return { updated: name, enabled, sync: summary };
  });

  ipcMain.handle(IPC.UPDATE_SERVER, (_event, name: string, spec: UpstreamServerSpec, resolvedSecrets?: Record<string, string>) => {
    const config = loadConfig();
    const secrets = new SecretsManager();
    
    // Store any new secret values before updating the server
    if (resolvedSecrets) {
      for (const [key, value] of Object.entries(resolvedSecrets)) {
        if (value) {
          secrets.setSecret(key, value);
        }
      }
    }
    
    updateServer(config, name, spec);
    saveConfig(config);
    const summary = syncAllClients(config, secrets);
    return { updated: name, sync: summary };
  });

  ipcMain.handle(IPC.SYNC_ALL, () => {
    const config = loadConfig();
    const secrets = new SecretsManager();
    return syncAllClients(config, secrets);
  });

  ipcMain.handle(IPC.DAEMON_START, async () => {
    const config = loadConfig();
    const secrets = new SecretsManager();
    return startDaemon(config, getCliDaemonPath(), secrets);
  });

  ipcMain.handle(IPC.DAEMON_STOP, () => {
    return stopDaemon();
  });

  ipcMain.handle(IPC.DAEMON_RESTART, async () => {
    const config = loadConfig();
    const secrets = new SecretsManager();
    return restartDaemon(config, getCliDaemonPath(), secrets);
  });

  ipcMain.handle(IPC.REGISTRY_LIST, (_event, cursor?: string, query?: string, limit?: number) => {
    return fetchRegistryServers(cursor, query, limit);
  });

  ipcMain.handle(IPC.REGISTRY_GET, (_event, name: string) => {
    return fetchServerDetail(name);
  });

  ipcMain.handle(IPC.REGISTRY_PREPARE_ADD, async (_event, registryName: string) => {
    const detail = await fetchServerDetail(registryName);
    const option = selectBestPackage(detail.server.packages, detail.server.remotes);
    const requiredInputs = extractRequiredInputs(option);
    // Derive a short local name from the registry name
    const shortName = registryName.split("/").pop() ?? registryName;
    pendingAdd = { name: shortName, option };
    return { shortName, requiredInputs, option };
  });

  ipcMain.handle(IPC.REGISTRY_CONFIRM_ADD, (_event, resolvedValues: Record<string, string>) => {
    if (!pendingAdd) throw new Error("No pending add operation");
    const { name, option } = pendingAdd;
    pendingAdd = null;
    const spec = mapServerToSpec(name, option, resolvedValues);
    const config = loadConfig();
    addServer(config, name, spec, true);
    saveConfig(config);
    const secrets = new SecretsManager();
    const summary = syncAllClients(config, secrets);
    return { added: name, sync: summary };
  });

  ipcMain.handle(IPC.EXECUTE_CLI_COMMAND, (_event, command: string) => {
    try {
      const { name, spec } = parseCliAddCommand(command);
      const config = loadConfig();
      addServer(config, name, spec, true);
      saveConfig(config);
      const secrets = new SecretsManager();
      const summary = syncAllClients(config, secrets);
      return { added: name, sync: summary };
    } catch (error) {
      throw new Error(`Failed to parse command: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}
