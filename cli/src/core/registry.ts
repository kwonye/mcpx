import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizeServerSpecEnabled, type McpxConfig, type UpstreamServerSpec } from "../types.js";
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
    throw new Error(`Server \"${name}\" does not exist.`);
  }

  delete config.servers[name];
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

  // 2. Token file
  try {
    const fileValue = fs.readFileSync(tokenPath, "utf8").trim();
    if (fileValue) {
      return fileValue;
    }
  } catch {
    // File doesn't exist — fall through
  }

  // 3. Generate new token
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

  return token;
}

export function registerProject(globalConfig: McpxConfig, projectPath: string, name?: string): void {
  if (!globalConfig.projects) {
    globalConfig.projects = {};
  }
  
  const projectName = name?.trim() || path.basename(projectPath);
  globalConfig.projects[projectPath] = {
    name: projectName,
    path: projectPath
  };
}

export function unregisterProject(globalConfig: McpxConfig, projectPath: string): void {
  if (globalConfig.projects) {
    delete globalConfig.projects[projectPath];
  }
}
