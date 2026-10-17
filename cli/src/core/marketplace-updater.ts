import fs from "node:fs";
import path from "node:path";
import { getMarketplaceUpdateLockPath, getMarketplaceUpdateStatePath, ensureParentDir } from "./paths.js";
import { refreshAutoUpdateMarketplaces } from "./marketplace.js";

export const MARKETPLACE_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 30_000;
const LOCK_STALE_MS = 30 * 60 * 1000;

interface UpdateState { lastRunAt?: string }

function readState(): UpdateState {
  try {
    return JSON.parse(fs.readFileSync(getMarketplaceUpdateStatePath(), "utf8"));
  } catch {
    return {};
  }
}

function writeState(state: UpdateState): void {
  const target = getMarketplaceUpdateStatePath();
  ensureParentDir(target);
  fs.writeFileSync(target, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function due(now = Date.now()): boolean {
  const last = readState().lastRunAt;
  return !last || !Number.isFinite(Date.parse(last)) || now - Date.parse(last) >= MARKETPLACE_UPDATE_INTERVAL_MS;
}

function acquireLock(): boolean {
  const target = getMarketplaceUpdateLockPath();
  ensureParentDir(target);
  try {
    fs.writeFileSync(target, `${process.pid}\n`, { flag: "wx", mode: 0o600 });
    return true;
  } catch {
    try {
      if (Date.now() - fs.statSync(target).mtimeMs > LOCK_STALE_MS) {
        fs.unlinkSync(target);
        return acquireLock();
      }
    } catch {
      return acquireLock();
    }
    return false;
  }
}

function releaseLock(): void {
  try { fs.unlinkSync(getMarketplaceUpdateLockPath()); } catch { /* best effort */ }
}

export async function runMarketplaceAutoUpdate(options?: { force?: boolean }): Promise<{ checked: string[]; errors: string[]; skipped?: boolean }> {
  if (process.env.MCPX_NO_UPDATE === "1") return { checked: [], errors: [], skipped: true };
  if (!options?.force && !due()) return { checked: [], errors: [], skipped: true };
  if (!acquireLock()) return { checked: [], errors: [], skipped: true };
  try {
    const result = await refreshAutoUpdateMarketplaces();
    writeState({ lastRunAt: new Date().toISOString() });
    return result;
  } finally {
    releaseLock();
  }
}

export function startMarketplaceAutoUpdater(): () => void {
  if (process.env.MCPX_NO_UPDATE === "1") return () => {};
  let stopped = false;
  const run = () => { if (!stopped) void runMarketplaceAutoUpdate().catch(() => undefined); };
  const initial = setTimeout(run, INITIAL_DELAY_MS);
  initial.unref?.();
  const interval = setInterval(run, MARKETPLACE_UPDATE_INTERVAL_MS);
  interval.unref?.();
  return () => {
    stopped = true;
    clearTimeout(initial);
    clearInterval(interval);
  };
}
