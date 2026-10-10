import fs from "node:fs";
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { getLogPath, getPidPath, ensureParentDir } from "./paths.js";
import { createGatewayServer } from "../gateway/server.js";
import { SecretsManager } from "./secrets.js";
import { ensureGatewayToken } from "./registry.js";
import type { McpxConfig } from "../types.js";
import { loadConfig } from "./config.js";
import { mutateConfig } from "./config-store.js";
import { lockOwnerAlive } from "./file-state.js";
import { controlRequest, startControlServer } from "./control.js";
import { syncAllClients, persistSyncState } from "./sync.js";
import { startBackgroundUpdateCheck } from "./update-manager.js";
import { withManagedIndexLock } from "./managed-index-lock.js";
import { getManagedIndexPath } from "./paths.js";
import { startMarketplaceAutoUpdater } from "./marketplace-updater.js";
import { captureTelemetryEvent, durationBucket } from "./telemetry.js";
import { capture } from "./analytics.js";

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  pidFile: string;
  logFile: string;
  port?: number;
  portMismatch?: boolean;
}

export interface DaemonStartResult {
  started: boolean;
  pid: number;
  port: number;
  message: string;
}

export function buildDaemonChildEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  electronRuntime = typeof process.versions.electron === "string",
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    MCPX_DAEMON_CHILD: "1",
    ...(electronRuntime ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
  };
}

function readPidRecordFromFile(pidPath = getPidPath()): { pid: number; port: number | null } | null {
  if (!fs.existsSync(pidPath)) {
    return null;
  }

  const raw = fs.readFileSync(pidPath, "utf8").trim();
  if (!raw) {
    return null;
  }

  const [pidRaw, portRaw] = raw.split(":");
  const pid = Number(pidRaw);
  if (!Number.isFinite(pid) || pid <= 0) {
    return null;
  }
  const port = portRaw ? Number(portRaw) : null;
  return { pid, port: Number.isFinite(port) && port! > 0 ? port : null };
}

function readPidFromFile(pidPath = getPidPath()): number | null {
  return readPidRecordFromFile(pidPath)?.pid ?? null;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer();

    tester.once("error", () => {
      resolve(false);
    });

    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });

    tester.listen(port, "127.0.0.1");
  });
}

export async function resolveGatewayPort(config: McpxConfig, secrets?: SecretsManager): Promise<{ port: number; fellBackFrom?: number }> {
  if (await isPortAvailable(config.gateway.port)) {
    return { port: config.gateway.port };
  }

  for (let offset = 1; offset <= 20; offset += 1) {
    const candidate = config.gateway.port + offset;
    if (candidate > 65535) {
      break;
    }

    if (await isPortAvailable(candidate)) {
      const oldPort = config.gateway.port;
      config.gateway.port = candidate;
      await mutateConfig(fresh => { fresh.gateway.port = candidate; });

      return { port: candidate, fellBackFrom: oldPort };
    }
  }

  throw new Error(`No available local port found near ${config.gateway.port}.`);
}

async function waitForGatewayReady(port: number, token: string, timeoutMs = 15000, expectedPid?: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`
        },
        signal: AbortSignal.timeout(500)
      });
      if (response.ok) {
        const health = await response.json() as { pid?: number; server?: string };
        if (health.server === "mcpx" && (!expectedPid || health.pid === expectedPid)) return;
      }
      lastError = new Error(`Gateway returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Gateway did not become ready within ${timeoutMs}ms: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export function getDaemonStatus(config: McpxConfig): DaemonStatus {
  const pidPath = getPidPath();
  const record = readPidRecordFromFile(pidPath);
  if (!record) {
    return {
      running: false,
      pidFile: pidPath,
      logFile: getLogPath(),
      port: config.gateway.port
    };
  }

  const running = processExists(record.pid);
  const port = record.port ?? config.gateway.port;
  return {
    running,
    pid: record.pid,
    pidFile: pidPath,
    logFile: getLogPath(),
    port,
    portMismatch: running && record.port !== null && record.port !== config.gateway.port
  };
}

export async function startDaemon(config: McpxConfig, cliPath: string, secrets: SecretsManager): Promise<DaemonStartResult> {
  const lockPath = `${getPidPath()}.start.lock`;
  ensureParentDir(lockPath);
  const deadline = Date.now() + 30000;
  while (true) {
    try { fs.writeFileSync(lockPath, String(process.pid), { flag: "wx", mode: 0o600 }); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!lockOwnerAlive(lockPath)) { try { fs.unlinkSync(lockPath); } catch {} continue; }
      if (Date.now() > deadline) throw new Error("Another mcpx startup did not finish.");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  try { return await startDaemonWithLease(config, cliPath, secrets); }
  finally { fs.rmSync(lockPath, { force: true }); }
}

async function startDaemonWithLease(config: McpxConfig, cliPath: string, secrets: SecretsManager): Promise<DaemonStartResult> {
  const startedAt = Date.now();
  const existingStatus = getDaemonStatus(config);
  if (existingStatus.running && existingStatus.pid) {
    // Treat a live pid record as authoritative while the daemon is starting.
    // Removing it when the port has not bound yet can launch a second daemon
    // during the desktop auto-start/toggle race.
    const result = {
      started: false,
      pid: existingStatus.pid,
      port: existingStatus.port ?? config.gateway.port,
      message: "mcpx daemon already running."
    };
    captureTelemetryEvent({
      name: "operation_completed",
      properties: { operation: "daemon_start", outcome: "success", durationBucket: durationBucket(Date.now() - startedAt) }
    });
    await waitForGatewayReady(result.port, ensureGatewayToken(config, secrets), 15000, result.pid);
    return result;
  }

  const { port, fellBackFrom } = await resolveGatewayPort(config, secrets);
  if (fellBackFrom) {
    process.stderr.write(`mcpx: port ${fellBackFrom} was unavailable; gateway started on ${port} instead. All client configs were re-synced to the new port.\n`);
  }
  const token = ensureGatewayToken(config, secrets);

  const pidPath = getPidPath();
  const logPath = getLogPath();
  ensureParentDir(pidPath);
  ensureParentDir(logPath);

  let logFd = fs.openSync(logPath, "a", 0o600);
  const logStat = fs.fstatSync(logFd);
  if (logStat.size > 10 * 1024 * 1024) {
    fs.closeSync(logFd);
    const log1 = `${logPath}.1`;
    const log2 = `${logPath}.2`;
    try { if (fs.existsSync(log2)) fs.unlinkSync(log2); } catch {}
    try { if (fs.existsSync(log1)) fs.renameSync(log1, log2); } catch {}
    try { fs.renameSync(logPath, log1); } catch {}
    logFd = fs.openSync(logPath, "a", 0o600);
  }

  const child = spawn(process.execPath, [cliPath, "daemon", "run", "--port", String(port)], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...buildDaemonChildEnv(), MCPX_CLI_ENTRY: cliPath }
  });

  fs.closeSync(logFd);
  child.unref();

  fs.writeFileSync(pidPath, `${child.pid}:${port}\n`, { mode: 0o600 });

  startBackgroundUpdateCheck();
  try { await waitForGatewayReady(port, token, 15000, child.pid); }
  catch (error) { child.kill("SIGTERM"); fs.rmSync(pidPath, { force: true }); throw error; }
  if (fellBackFrom) {
    const fresh = loadConfig();
    const targets = Object.keys(fresh.clients);
    if (targets.length) {
      const summary = syncAllClients(fresh, secrets, { targetClients: targets });
      await mutateConfig(latest => persistSyncState(summary, latest));
    }
  }

  capture("daemon_started", { port });
  const result = {
    started: true,
    pid: child.pid ?? -1,
    port,
    message: "mcpx daemon started."
  };
  captureTelemetryEvent({
    name: "operation_completed",
    properties: { operation: "daemon_start", outcome: "success", durationBucket: durationBucket(Date.now() - startedAt) }
  });
  return result;
}

export async function stopDaemon(): Promise<{ stopped: boolean; message: string }> {
  const startedAt = Date.now();
  const pidPath = getPidPath();
  const pid = readPidFromFile(pidPath);

  if (!pid) {
    const result = {
      stopped: false,
      message: "mcpx daemon is not running."
    };
    captureTelemetryEvent({
      name: "operation_completed",
      properties: { operation: "daemon_stop", outcome: "success", durationBucket: durationBucket(Date.now() - startedAt) }
    });
    return result;
  }

  try {
    const health = await controlRequest<{ pid: number; activeWriters: number }>("service.health");
    if (health.pid !== pid) throw new Error("The PID record does not identify the running mcpx service.");
    if (health.activeWriters > 0) throw new Error("mcpx is applying changes. Let the active operation finish before stopping the service.");
  } catch (error) {
    if (!["ENOENT", "ECONNREFUSED", "FailedToOpenSocket"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
  }

  // PID safety: verify the process is actually a mcpx daemon before killing
  try {
    const cmd = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8", timeout: 2000 }).trim();
    const looksLikeMcpxDaemon = cmd.includes("daemon run") && (cmd.includes("mcpx") || cmd.includes("cli.js"));
    if (!looksLikeMcpxDaemon) {
      fs.unlinkSync(pidPath);
      const result = {
        stopped: false,
        message: `PID ${pid} is not a mcpx daemon (command: ${cmd.slice(0, 80)}). Pidfile cleaned up.`
      };
      captureTelemetryEvent({
        name: "operation_completed",
        properties: { operation: "daemon_stop", outcome: "failure", errorCode: "invalid_pid", durationBucket: durationBucket(Date.now() - startedAt) }
      });
      return result;
    }
  } catch {
    // Process doesn't exist or ps failed; clean up pidfile
    try { fs.unlinkSync(pidPath); } catch {}
    const result = {
      stopped: false,
      message: `PID ${pid} not found. Pidfile cleaned up.`
    };
    captureTelemetryEvent({
      name: "operation_completed",
      properties: { operation: "daemon_stop", outcome: "failure", errorCode: "pid_not_found", durationBucket: durationBucket(Date.now() - startedAt) }
    });
    return result;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Ignore already dead process.
  }

  const deadline = Date.now() + 10000;
  while (processExists(pid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  if (processExists(pid)) throw new Error(`mcpx daemon ${pid} did not stop; its PID record was retained.`);

  try {
    fs.unlinkSync(pidPath);
  } catch {
    // Ignore cleanup failure.
  }

  capture("daemon_stopped", {});
  const result = {
    stopped: true,
    message: `Stopped mcpx daemon (pid ${pid}).`
  };
  captureTelemetryEvent({
    name: "operation_completed",
    properties: { operation: "daemon_stop", outcome: "success", durationBucket: durationBucket(Date.now() - startedAt) }
  });
  return result;
}

export async function restartDaemon(config: McpxConfig, cliPath: string, secrets: SecretsManager): Promise<DaemonStartResult> {
  const startedAt = Date.now();
  await stopDaemon();
  try {
    const result = await startDaemon(config, cliPath, secrets);
    captureTelemetryEvent({
      name: "operation_completed",
      properties: { operation: "daemon_restart", outcome: "success", durationBucket: durationBucket(Date.now() - startedAt) }
    });
    return result;
  } catch (error) {
    captureTelemetryEvent({
      name: "operation_completed",
      properties: { operation: "daemon_restart", outcome: "failure", errorCode: "daemon_restart_failed", durationBucket: durationBucket(Date.now() - startedAt) }
    });
    throw error;
  }
}

export function readDaemonLogs(maxLines = 200): string {
  const logPath = getLogPath();
  if (!fs.existsSync(logPath)) {
    return "";
  }

  const lines = fs.readFileSync(logPath, "utf8").split("\n");
  return lines.slice(Math.max(lines.length - maxLines, 0)).join("\n");
}

export async function runDaemonForeground(config: McpxConfig, port: number, secrets: SecretsManager): Promise<void> {
  const stopControl = await startControlServer();
  return new Promise((resolve, reject) => {
    const server = createGatewayServer({ port, expectedToken: ensureGatewayToken(config, secrets), secrets });
    const stopMarketplaceUpdater = startMarketplaceAutoUpdater();
    let closing = false;
    const cleanup = () => {
      if (closing) return;
      closing = true;
      stopMarketplaceUpdater();
      void stopControl().finally(() => server.close(() => resolve()));
      server.closeIdleConnections();
    };
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
    server.on("error", error => { void stopControl().finally(() => reject(error)); });
  });
}
