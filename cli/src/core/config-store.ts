import fs from "node:fs";
import path from "node:path";
import { loadConfig, saveConfig, type McpxConfig } from "./config.js";
import { getConfigPath } from "./paths.js";

const LOCK_STALE_MS = 5000;
const LOCK_RETRY_MS = 50;
const LOCK_MAX_RETRIES = 40;

let inProcessQueue: Promise<unknown> = Promise.resolve();

function getLockPath(configPath: string): string {
  return `${configPath}.lock`;
}

function acquireLock(configPath: string): boolean {
  const lockPath = getLockPath(configPath);
  try {
    const fd = fs.openSync(lockPath, "wx");
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      return false;
    }
    // Stale lock check
    try {
      const stat = fs.statSync(lockPath);
      if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        fs.unlinkSync(lockPath);
        return acquireLock(configPath);
      }
    } catch {
      // lock file disappeared — retry
      return acquireLock(configPath);
    }
    return false;
  }
}

function releaseLock(configPath: string): void {
  try {
    fs.unlinkSync(getLockPath(configPath));
  } catch {
    // best effort
  }
}

export async function mutateConfig<T>(
  fn: (config: McpxConfig) => T | Promise<T>,
  configPath?: string
): Promise<T> {
  const resolvedPath = configPath ?? getConfigPath();

  // In-process queue: serialize all mutations
  const result = await (inProcessQueue = inProcessQueue.then(
    () => executeWithLock(fn, resolvedPath)
  ));
  return result as T;
}

async function executeWithLock<T>(
  fn: (config: McpxConfig) => T | Promise<T>,
  configPath: string
): Promise<T> {
  // Acquire cross-process lock with backoff
  let acquired = false;
  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt++) {
    acquired = acquireLock(configPath);
    if (acquired) break;
    await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
  }

  if (!acquired) {
    throw new Error(`Could not acquire config lock for ${configPath}.`);
  }

  try {
    // Reload fresh inside the lock
    const config = loadConfig(configPath);
    const result = await fn(config);
    saveConfig(config, configPath);
    return result;
  } finally {
    releaseLock(configPath);
  }
}
