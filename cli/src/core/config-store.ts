import fs from "node:fs";
import path from "node:path";
import { loadConfig, saveConfig, loadProjectConfig, saveProjectConfig, type ProjectLocalConfig } from "./config.js";
import type { McpxConfig, UpstreamServerSpec } from "../types.js";
import { getConfigPath, findProjectConfigPath } from "./paths.js";

const LOCK_STALE_MS = 5000;
const LOCK_RETRY_MS = 50;
const LOCK_MAX_RETRIES = 40;

// Keyed by file path so mutations against different files (e.g. the global
// config vs. a project's .mcpx.json) don't needlessly serialize against each
// other within the same process; same-file mutations still queue in order.
const inProcessQueues = new Map<string, Promise<unknown>>();

function getLockPath(filePath: string): string {
  return `${filePath}.lock`;
}

function acquireLock(filePath: string): boolean {
  const lockPath = getLockPath(filePath);
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
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
        return acquireLock(filePath);
      }
    } catch {
      // lock file disappeared — retry
      return acquireLock(filePath);
    }
    return false;
  }
}

function releaseLock(filePath: string): void {
  try {
    fs.unlinkSync(getLockPath(filePath));
  } catch {
    // best effort
  }
}

/**
 * Generic read-modify-write helper: serializes mutations to a single file
 * both within this process (an in-process queue) and across processes (an
 * exclusive-create lock file), reloading fresh from disk inside the lock so
 * concurrent writers never clobber each other's changes.
 */
export function mutateFile<C, T>(
  filePath: string,
  load: (path: string) => C,
  save: (data: C, path: string) => void,
  fn: (data: C) => T | Promise<T>
): Promise<T> {
  const prevQueue = inProcessQueues.get(filePath) ?? Promise.resolve();
  const nextQueue = prevQueue.then(
    () => executeWithLock(filePath, load, save, fn),
    () => executeWithLock(filePath, load, save, fn)
  );
  // Keep the stored queue alive even if this mutation rejects, so later
  // mutations against the same file still wait their turn instead of racing
  // ahead of a still-in-flight one.
  inProcessQueues.set(filePath, nextQueue.catch(() => undefined));
  return nextQueue;
}

async function executeWithLock<C, T>(
  filePath: string,
  load: (path: string) => C,
  save: (data: C, path: string) => void,
  fn: (data: C) => T | Promise<T>
): Promise<T> {
  // Acquire cross-process lock with backoff
  let acquired = false;
  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt++) {
    acquired = acquireLock(filePath);
    if (acquired) break;
    await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
  }

  if (!acquired) {
    throw new Error(`Could not acquire lock for ${filePath}.`);
  }

  try {
    // Reload fresh inside the lock
    const data = load(filePath);
    const result = await fn(data);
    save(data, filePath);
    return result;
  } finally {
    releaseLock(filePath);
  }
}

export function mutateConfig<T>(
  fn: (config: McpxConfig) => T | Promise<T>,
  configPath?: string
): Promise<T> {
  return mutateFile(configPath ?? getConfigPath(), loadConfig, saveConfig, fn);
}

export function mutateProjectConfig<T>(
  projectConfigPath: string,
  fn: (config: ProjectLocalConfig) => T | Promise<T>
): Promise<T> {
  return mutateFile(projectConfigPath, (p) => loadProjectConfig(p), saveProjectConfig, fn);
}

export interface MutateActiveConfigResult<T> {
  type: "global" | "project";
  configPath: string;
  projectPath?: string;
  result: T;
}

/**
 * Locked equivalent of resolveActiveConfig(): resolves global vs. project vs.
 * local-project scope exactly as resolveActiveConfig does, but runs the
 * mutator against a config reloaded fresh from disk inside a lock scoped to
 * the file that will actually be written, so concurrent CLI invocations
 * (e.g. several `mcpx add` calls run in parallel) can never clobber each
 * other's changes.
 */
export async function mutateActiveConfig<T>(
  options: { global?: boolean; local?: boolean },
  mutator: (config: McpxConfig, ctx: { type: "global" | "project"; projectPath?: string }) => T | Promise<T>
): Promise<MutateActiveConfigResult<T>> {
  const globalPath = getConfigPath();

  if (!options.global) {
    const projectConfigPath = findProjectConfigPath();

    if (options.local) {
      const projectPath = projectConfigPath ? path.dirname(projectConfigPath) : process.cwd();
      const localPath = path.join(projectPath, ".mcpx.json");
      // Read-only snapshot of the global catalog, used only to build the merged
      // view the mutator sees and to decide which servers are "local" when
      // persisting back — this branch never writes to the global file.
      const globalConfig = loadConfig(globalPath);

      const result = await mutateProjectConfig(localPath, async (projectConfig) => {
        const mergedConfig: McpxConfig = {
          ...globalConfig,
          servers: { ...globalConfig.servers, ...projectConfig.servers }
        };
        const mutatorResult = await mutator(mergedConfig, { type: "project", projectPath });

        const localServers: Record<string, UpstreamServerSpec> = {};
        for (const [name, spec] of Object.entries(mergedConfig.servers)) {
          if (!(name in globalConfig.servers)) {
            localServers[name] = spec;
          }
        }
        projectConfig.servers = localServers;

        return mutatorResult;
      });

      return { type: "project", configPath: localPath, projectPath, result };
    }

    if (projectConfigPath) {
      const projectPath = path.dirname(projectConfigPath);
      const result = await mutateConfig((config) => mutator(config, { type: "project", projectPath }), globalPath);
      return { type: "project", configPath: globalPath, projectPath, result };
    }
  }

  const result = await mutateConfig((config) => mutator(config, { type: "global" }), globalPath);
  return { type: "global", configPath: globalPath, result };
}
