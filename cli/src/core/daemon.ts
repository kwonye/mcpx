import fs from "node:fs";
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { getLogPath, getPidPath, ensureParentDir } from "./paths.js";
import { createGatewayServer } from "../gateway/server.js";
import { SecretsManager } from "./secrets.js";
import { ensureGatewayToken } from "./registry.js";
import type { McpxConfig } from "../types.js";
import { saveConfig } from "./config.js";
import { syncAllClients, persistSyncState } from "./sync.js";
import { startBackgroundUpdateCheck } from "./update-manager.js";
import { withManagedIndexLock } from "./managed-index-lock.js";
import { getManagedIndexPath } from "./paths.js";
import { startMarketplaceAutoUpdater } from "./marketplace-updater.js";

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
      saveConfig(config);

      // Sync clients so their URLs reflect the new port
      if (secrets) {
        try {
          const summary = syncAllClients(config, secrets);
          persistSyncState(summary, config);
          saveConfig(config);
        } catch {
          // Best-effort sync after port change
        }
      }

      return { port: candidate, fellBackFrom: oldPort };
    }
  }

  throw new Error(`No available local port found near ${config.gateway.port}.`);
}

async function waitForGatewayReady(port: number, token: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`
        },
        signal: AbortSignal.timeout(500)
      });
      if (response.ok) {
        return;
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
  const existingStatus = getDaemonStatus(config);
  if (existingStatus.running && existingStatus.pid) {
    const portAvailable = await isPortAvailable(config.gateway.port);
    if (!portAvailable) {
      return {
        started: false,
        pid: existingStatus.pid,
        port: config.gateway.port,
        message: "mcpx daemon already running."
      };
    }

    try { fs.unlinkSync(getPidPath()); } catch {}
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
    env: buildDaemonChildEnv()
  });

  child.unref();

  fs.writeFileSync(pidPath, `${child.pid}:${port}\n`, { mode: 0o600 });

  startBackgroundUpdateCheck();
  await waitForGatewayReady(port, token);

  return {
    started: true,
    pid: child.pid ?? -1,
    port,
    message: "mcpx daemon started."
  };
}

export function stopDaemon(): { stopped: boolean; message: string } {
  const pidPath = getPidPath();
  const pid = readPidFromFile(pidPath);

  if (!pid) {
    return {
      stopped: false,
      message: "mcpx daemon is not running."
    };
  }

  // PID safety: verify the process is actually a mcpx daemon before killing
  try {
    const cmd = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8", timeout: 2000 }).trim();
    const looksLikeMcpxDaemon = cmd.includes("daemon run") && (cmd.includes("mcpx") || cmd.includes("cli.js"));
    if (!looksLikeMcpxDaemon) {
      fs.unlinkSync(pidPath);
      return {
        stopped: false,
        message: `PID ${pid} is not a mcpx daemon (command: ${cmd.slice(0, 80)}). Pidfile cleaned up.`
      };
    }
  } catch {
    // Process doesn't exist or ps failed; clean up pidfile
    try { fs.unlinkSync(pidPath); } catch {}
    return {
      stopped: false,
      message: `PID ${pid} not found. Pidfile cleaned up.`
    };
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Ignore already dead process.
  }

  try {
    fs.unlinkSync(pidPath);
  } catch {
    // Ignore cleanup failure.
  }

  return {
    stopped: true,
    message: `Stopped mcpx daemon (pid ${pid}).`
  };
}

export async function restartDaemon(config: McpxConfig, cliPath: string, secrets: SecretsManager): Promise<DaemonStartResult> {
  stopDaemon();
  return startDaemon(config, cliPath, secrets);
}

export function readDaemonLogs(maxLines = 200): string {
  const logPath = getLogPath();
  if (!fs.existsSync(logPath)) {
    return "";
  }

  const lines = fs.readFileSync(logPath, "utf8").split("\n");
  return lines.slice(Math.max(lines.length - maxLines, 0)).join("\n");
}

export function runDaemonForeground(config: McpxConfig, port: number, secrets: SecretsManager): Promise<void> {
  return new Promise((resolve, reject) => {
    const token = ensureGatewayToken(config, secrets);

    const server = createGatewayServer({
      port,
      expectedToken: token,
      secrets
    });
    const stopMarketplaceUpdater = startMarketplaceAutoUpdater();

    const cleanup = () => {
      stopMarketplaceUpdater();
      server.close(() => resolve());
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    server.on("error", (error) => {
      reject(error);
    });
  });
}
