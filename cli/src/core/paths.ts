import os from "node:os";
import path from "node:path";
import fs from "node:fs";

function envOrDefault(value: string | undefined, fallback: string): string {
  if (value && value.trim().length > 0) {
    return value;
  }
  return fallback;
}

// Bun's os.homedir() ignores runtime HOME mutations (native syscall). Read
// process.env.HOME first so tests can override the home directory.
export function homeDir(): string {
  return process.env.HOME ?? os.homedir();
}

export function getConfigRoot(): string {
  return envOrDefault(process.env.MCPX_CONFIG_HOME ?? process.env.XDG_CONFIG_HOME, path.join(homeDir(),".config"));
}

export function getDataRoot(): string {
  return envOrDefault(process.env.MCPX_DATA_HOME ?? process.env.XDG_DATA_HOME, path.join(homeDir(),".local", "share"));
}

export function getStateRoot(): string {
  return envOrDefault(process.env.MCPX_STATE_HOME ?? process.env.XDG_STATE_HOME, path.join(homeDir(),".local", "state"));
}

export function getConfigPath(): string {
  return path.join(getConfigRoot(), "mcpx", "config.json");
}

export function getSkillsDir(): string {
  return path.join(getConfigRoot(), "mcpx", "skills");
}

export function getManagedIndexPath(): string {
  return path.join(getDataRoot(), "mcpx", "managed-index.json");
}

export function getSecretsStorePath(): string {
  return path.join(getDataRoot(), "mcpx", "secrets.json");
}

export function getSecretsKeyPath(): string {
  return path.join(getDataRoot(), "mcpx", "secrets.key");
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

export function getGatewayTokenPath(secretName: string): string {
  return path.join(getConfigRoot(), "mcpx", `${secretName}.token`);
}

export function getUpdatesDir(): string {
  return path.join(getDataRoot(), "mcpx", "updates");
}

export function getStagedVersionPath(): string {
  return path.join(getUpdatesDir(), "staged-version.json");
}

export function getUpdateLockPath(): string {
  return path.join(getUpdatesDir(), ".update.lock");
}

export function getPluginCacheRoot(): string {
  return path.join(getDataRoot(), "mcpx", "plugins", "cache");
}

export function getPluginDataRoot(): string {
  return path.join(getDataRoot(), "mcpx", "plugins", "data");
}

export function getPluginProjectionsRoot(): string {
  return path.join(getDataRoot(), "mcpx", "plugins", "projections");
}

export function getPluginLogsRoot(): string {
  return path.join(getStateRoot(), "mcpx", "plugins", "logs");
}

export function getMarketplaceCacheRoot(): string {
  return path.join(getDataRoot(), "mcpx", "marketplaces", "cache");
}

export function getMarketplaceUpdateStatePath(): string {
  return path.join(getStateRoot(), "mcpx", "marketplaces", "update-state.json");
}

export function getMarketplaceUpdateLockPath(): string {
  return path.join(getStateRoot(), "mcpx", "marketplaces", ".update.lock");
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function findProjectConfigPath(startDir = process.cwd()): string | null {
  let dir = startDir;
  while (true) {
    const candidate = path.join(dir, ".mcpx.json");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

export function findProjectRoot(startDir = process.cwd()): string | null {
  const configPath = findProjectConfigPath(startDir);
  return configPath ? path.dirname(configPath) : null;
}
