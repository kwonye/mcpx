import fs from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";
import { getLogPath, getPidPath, ensureParentDir } from "./paths.js";
import { createGatewayServer } from "../gateway/server.js";
import { SecretsManager } from "./secrets.js";
import { ensureGatewayToken, getGatewayTokenSecretName } from "./registry.js";
import type { McpxConfig } from "../types.js";
import { saveConfig } from "./config.js";

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  pidFile: string;
  logFile: string;
  port?: number;
}

export interface DaemonStartResult {
  started: boolean;
  pid: number;
  port: number;
  message: string;
}

function readPidFromFile(pidPath = getPidPath()): number | null {
  if (!fs.existsSync(pidPath)) {
    return null;
  }

  const raw = fs.readFileSync(pidPath, "utf8").trim();
  if (!raw) {
    return null;
  }

  const pid = Number(raw);
  if (!Number.isFinite(pid) || pid <= 0) {
    return null;
  }

  return pid;
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

export async function resolveGatewayPort(config: McpxConfig): Promise<number> {
  if (await isPortAvailable(config.gateway.port)) {
    return config.gateway.port;
  }

  for (let offset = 1; offset <= 20; offset += 1) {
    const candidate = config.gateway.port + offset;
    if (candidate > 65535) {
      break;
    }

    if (await isPortAvailable(candidate)) {
      config.gateway.port = candidate;
      saveConfig(config);
      return candidate;
    }
  }

  throw new Error(`No available local port found near ${config.gateway.port}.`);
}

export function getDaemonStatus(config: McpxConfig): DaemonStatus {
  const pidPath = getPidPath();
  const pid = readPidFromFile(pidPath);
  if (!pid) {
    return {
      running: false,
      pidFile: pidPath,
      logFile: getLogPath(),
      port: config.gateway.port
    };
  }

  return {
    running: processExists(pid),
    pid,
    pidFile: pidPath,
    logFile: getLogPath(),
    port: config.gateway.port
  };
}

export async function startDaemon(config: McpxConfig, cliPath: string, secrets: SecretsManager): Promise<DaemonStartResult> {
  const existingStatus = getDaemonStatus(config);
  if (existingStatus.running && existingStatus.pid) {
    return {
      started: false,
      pid: existingStatus.pid,
      port: config.gateway.port,
      message: "mcpx daemon already running."
    };
  }

  const port = await resolveGatewayPort(config);
  ensureGatewayToken(config, secrets);

  const pidPath = getPidPath();
  const logPath = getLogPath();
  ensureParentDir(pidPath);
  ensureParentDir(logPath);

  const logFd = fs.openSync(logPath, "a", 0o600);
  const child = spawn(process.execPath, [cliPath, "daemon", "run", "--port", String(port)], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      MCPX_DAEMON_CHILD: "1"
    }
  });

  child.unref();

  fs.writeFileSync(pidPath, `${child.pid}\n`, { mode: 0o600 });

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
    const tokenName = getGatewayTokenSecretName(config);
    const token = secrets.getSecret(tokenName);

    if (!token) {
      reject(new Error(`Local gateway token not found: ${tokenName}`));
      return;
    }

    const server = createGatewayServer({
      port,
      expectedToken: token,
      secrets
    });

    const cleanup = () => {
      server.close(() => resolve());
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    server.on("error", (error) => {
      reject(error);
    });
  });
}
