import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isServerEnabled, normalizeServerSpecEnabled, type McpxConfig, type UpstreamServerSpec } from "../types.js";
import { SecretsManager } from "./secrets.js";
import { getGatewayTokenPath, ensureParentDir } from "./paths.js";

export function validateServerName(name: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/.test(name)) {
    throw new Error("Invalid server name. Use 1-63 chars: letters, numbers, '.', '-', '_' and start with alphanumeric.");
  }
}

export function addServer(config: McpxConfig, name: string, spec: UpstreamServerSpec, force = false): void {
  validateServerName(name);

  if (config.servers[name] && !force) {
    throw new Error(`Server \"${name}\" already exists. Use --force to overwrite.`);
  }

  config.servers[name] = normalizeServerSpecEnabled(spec);
}

export function removeServer(config: McpxConfig, name: string, force = false): void {
  if (!config.servers[name] && !force) {
    throw new Error(`Server "${name}" does not exist.`);
  }

  delete config.servers[name];

  // Strip the server name from every project's disabledServers
  if (config.projects) {
    for (const project of Object.values(config.projects)) {
      if (project.disabledServers) {
        project.disabledServers = project.disabledServers.filter((s) => s !== name);
      }
    }
  }
}

export function updateServer(config: McpxConfig, name: string, spec: UpstreamServerSpec): void {
  validateServerName(name);

  if (!config.servers[name]) {
    throw new Error(`Server \"${name}\" does not exist.`);
  }

  config.servers[name] = normalizeServerSpecEnabled(spec);
}

export function setServerEnabled(config: McpxConfig, name: string, enabled: boolean): void {
  const existing = config.servers[name];
  if (!existing) {
    throw new Error(`Server "${name}" does not exist.`);
  }

  config.servers[name] = {
    ...existing,
    enabled
  };
}

export function getGatewayTokenSecretName(config: McpxConfig): string {
  if (!config.gateway.tokenRef.startsWith("secret://")) {
    return "local_gateway_token";
  }

  return config.gateway.tokenRef.slice("secret://".length) || "local_gateway_token";
}

export function ensureGatewayToken(config: McpxConfig, secrets: SecretsManager): string {
  const secretName = getGatewayTokenSecretName(config);
  const tokenPath = getGatewayTokenPath(secretName);

  // 1. Env override (preserves desktop-app daemon spawning)
  const envValue = process.env[`MCPX_SECRET_${secretName}`];
  if (envValue && envValue.length > 0) {
    return envValue;
  }

  // 2. Token file — single source of truth (no store write)
  try {
    const fileValue = fs.readFileSync(tokenPath, "utf8").trim();
    if (fileValue) {
      return fileValue;
    }
  } catch {
    // File doesn't exist — fall through
  }

  // 3. Migration fallback: if encrypted store has the token, re-create the file
  const storeValue = secrets.getSecret(secretName);
  if (storeValue) {
    ensureParentDir(tokenPath);
    fs.writeFileSync(tokenPath, storeValue, { mode: 0o600 });
    return storeValue;
  }

  // 4. Generate new token — write to file only (never to encrypted store)
  const token = crypto.randomBytes(32).toString("base64url");
  ensureParentDir(tokenPath);
  fs.writeFileSync(tokenPath, token, { mode: 0o600 });
  return token;
}

export function rotateGatewayToken(config: McpxConfig, secrets: SecretsManager): string {
  const secretName = getGatewayTokenSecretName(config);
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenPath = getGatewayTokenPath(secretName);

  ensureParentDir(tokenPath);
  fs.writeFileSync(tokenPath, token, { mode: 0o600 });
  // Remove the encrypted-store mirror so there's only one source of truth
  secrets.removeSecret(secretName);

  return token;
}

export function registerProject(globalConfig: McpxConfig, projectPath: string, name?: string): void {
  if (!globalConfig.projects) {
    globalConfig.projects = {};
  }

  const resolvedPath = path.resolve(projectPath);
  const projectName = name?.trim() || path.basename(resolvedPath);
  const existing = globalConfig.projects[resolvedPath];
  globalConfig.projects[resolvedPath] = {
    name: projectName,
    path: resolvedPath,
    disabledServers: existing?.disabledServers ?? []
  };
}

export function unregisterProject(globalConfig: McpxConfig, projectPath: string): void {
  if (globalConfig.projects) {
    delete globalConfig.projects[path.resolve(projectPath)];
  }
}

export function setProjectServerEnabled(
  globalConfig: McpxConfig,
  projectPath: string,
  serverName: string,
  enabled: boolean
): { effective: boolean; reason?: "globally_disabled" } {
  if (!globalConfig.projects) globalConfig.projects = {};
  const resolvedPath = path.resolve(projectPath);
  const project = globalConfig.projects[resolvedPath];
  if (!project) {
    throw new Error(`Project "${resolvedPath}" is not registered.`);
  }

  // Validate server exists
  const serverSpec = globalConfig.servers[serverName];
  if (!serverSpec) {
    throw new Error(`Server "${serverName}" does not exist.`);
  }

  if (!project.disabledServers) {
    project.disabledServers = [];
  }

  if (enabled) {
    project.disabledServers = project.disabledServers.filter((s) => s !== serverName);
    // If the server is globally disabled, the project enable is not effective
    if (!isServerEnabled(serverSpec)) {
      return { effective: false, reason: "globally_disabled" };
    }
  } else {
    if (!project.disabledServers.includes(serverName)) {
      project.disabledServers.push(serverName);
    }
  }

  return { effective: true };
}
