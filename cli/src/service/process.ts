// Process and log helpers shared by the daemon lifecycle and the service layer.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import { spawnSync } from "node:child_process";

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** SIGKILL on POSIX, `taskkill /T /F` (whole tree) on Windows. Returns whether the kill was delivered. */
export function forceKill(pid: number, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 10_000 });
    return result.status === 0;
  }
  try {
    process.kill(pid, "SIGKILL");
    return true;
  } catch {
    return false;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs: number, intervalMs = 100): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (await predicate()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(intervalMs);
  }
}

export function waitForSync(predicate: () => boolean, timeoutMs: number, intervalMs = 100): boolean {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (predicate()) return true;
    if (Date.now() >= deadline) return false;
    sleepSync(intervalMs);
  }
}

/** Approximate wall-clock boot time; anything recorded well before it cannot still be running. */
export function bootTimeMs(): number {
  return Date.now() - os.uptime() * 1000;
}

export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => tester.close(() => resolve(true)));
    tester.listen(port, "127.0.0.1");
  });
}

export const LOG_ROTATE_BYTES = 10 * 1024 * 1024;

/**
 * Size-based rotation that is safe while the daemon (or a supervisor) still
 * holds the log open for append: copy to `.1` (shifting older generations),
 * then truncate in place. Writers using O_APPEND continue at the new end.
 */
export function rotateLogIfNeeded(logPath: string, maxBytes = LOG_ROTATE_BYTES, keep = 2): boolean {
  let size: number;
  try {
    size = fs.statSync(logPath).size;
  } catch {
    return false;
  }
  if (size <= maxBytes) return false;
  try {
    try { fs.unlinkSync(`${logPath}.${keep}`); } catch { /* none */ }
    for (let generation = keep - 1; generation >= 1; generation -= 1) {
      try { fs.renameSync(`${logPath}.${generation}`, `${logPath}.${generation + 1}`); } catch { /* none */ }
    }
    fs.copyFileSync(logPath, `${logPath}.1`);
    fs.truncateSync(logPath, 0);
    return true;
  } catch {
    return false;
  }
}
