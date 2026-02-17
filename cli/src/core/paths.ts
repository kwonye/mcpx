import os from "node:os";
import path from "node:path";
import fs from "node:fs";

function envOrDefault(value: string | undefined, fallback: string): string {
  if (value && value.trim().length > 0) {
    return value;
  }
  return fallback;
}

export function getConfigRoot(): string {
  return envOrDefault(process.env.MCPX_CONFIG_HOME ?? process.env.XDG_CONFIG_HOME, path.join(os.homedir(), ".config"));
}

export function getDataRoot(): string {
  return envOrDefault(process.env.MCPX_DATA_HOME ?? process.env.XDG_DATA_HOME, path.join(os.homedir(), ".local", "share"));
}

export function getStateRoot(): string {
  return envOrDefault(process.env.MCPX_STATE_HOME ?? process.env.XDG_STATE_HOME, path.join(os.homedir(), ".local", "state"));
}

export function getConfigPath(): string {
  return path.join(getConfigRoot(), "mcpx", "config.json");
}

export function getManagedIndexPath(): string {
  return path.join(getDataRoot(), "mcpx", "managed-index.json");
}

export function getSecretNamesPath(): string {
  return path.join(getDataRoot(), "mcpx", "secret-names.json");
}

export function getRuntimeDir(): string {
  return path.join(getStateRoot(), "mcpx", "runtime");
}

export function getLogDir(): string {
  return path.join(getStateRoot(), "mcpx", "logs");
}

export function getPidPath(): string {
  return path.join(getRuntimeDir(), "daemon.pid");
}

export function getLogPath(): string {
  return path.join(getLogDir(), "daemon.log");
}

export function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}
