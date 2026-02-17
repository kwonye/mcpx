import type { McpxConfig, UpstreamServerSpec } from "../types.js";
import { SecretsManager } from "./secrets.js";

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

  config.servers[name] = spec;
}

export function removeServer(config: McpxConfig, name: string, force = false): void {
  if (!config.servers[name] && !force) {
    throw new Error(`Server \"${name}\" does not exist.`);
  }

  delete config.servers[name];
}

export function getGatewayTokenSecretName(config: McpxConfig): string {
  if (!config.gateway.tokenRef.startsWith("secret://")) {
    return "local_gateway_token";
  }

  return config.gateway.tokenRef.slice("secret://".length) || "local_gateway_token";
}

export function ensureGatewayToken(config: McpxConfig, secrets: SecretsManager): string {
  const secretName = getGatewayTokenSecretName(config);
  const existing = secrets.getSecret(secretName);

  if (existing) {
    return existing;
  }

  return secrets.rotateLocalToken(secretName);
}
