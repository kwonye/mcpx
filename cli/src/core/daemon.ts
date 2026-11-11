import crypto from "node:crypto";
import fs from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import {
  getConfigPath,
  getControlEndpoint,
  getLogPath,
  getPidPath,
  getRuntimeRecordPath,
  getServiceLogPath,
  ensureParentDir
} from "./paths.js";
import { createGatewayServer } from "../gateway/server.js";
import { SecretsManager } from "./secrets.js";
import { ensureGatewayToken } from "./registry.js";
import type { McpxConfig } from "../types.js";
import { startBackgroundUpdateCheck } from "./update-manager.js";
import { withManagedIndexLock } from "./managed-index-lock.js";
import { getManagedIndexPath } from "./paths.js";
import { startMarketplaceAutoUpdater } from "./marketplace-updater.js";
import { captureTelemetryEvent, durationBucket } from "./telemetry.js";
import { APP_VERSION } from "../version.js";
import {
  DAEMON_EXIT_ALREADY_RUNNING,
  DAEMON_EXIT_PORT_IN_USE,
  DAEMON_LOG_FILE_ENV,
  SUPERVISED_ENV
} from "../service/constants.js";
import {
  DaemonAlreadyRunningError,
  acquireInstanceGuard,
  endpointIsLive,
  looksLikeMcpxGateway,
  looksLikeMcpxGatewaySync,
  pingDaemon,
  pingDaemonSync,
  readRuntimeRecord,
  removeRuntimeRecord,
  requestShutdown,
  requestShutdownSync,
  writeRuntimeRecord,
  type DaemonPing
} from "../service/endpoint.js";
import {
  bootTimeMs,
  forceKill,
  isPidAlive,
  isPortAvailable,
  rotateLogIfNeeded,
  waitFor,
  waitForSync
} from "../service/process.js";
import {
  findInstalledServiceManager,
  resolveServiceContext,
  type ServiceContext,
  type ServiceManager,
  type ServiceManagerKind
} from "../service/managers.js";

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  /** The daemon-owned runtime record (formerly the parent-written pid file). */
  pidFile: string;
  logFile: string;
  port?: number;
  portMismatch?: boolean;
  version?: string;
  instanceId?: string;
  startedAt?: string;
  /** True when the answer came from the daemon itself rather than from files. */
  verified?: boolean;
  /** A daemon started by an older mcpx (pid-file era). */
  legacy?: boolean;
  /** The installed OS service definition, if any. */
  service?: ServiceManagerKind | null;
}

export interface DaemonStartResult {
  started: boolean;
  pid: number;
  port: number;
  message: string;
  version?: string;
  instanceId?: string;
  /** Set when an installed OS service manager started (or already runs) the daemon. */
  supervisor?: ServiceManagerKind | null;
}

export interface DaemonStopResult {
  stopped: boolean;
  message: string;
  pid?: number;
  /** The daemon did not exit after a shutdown request and was killed. */
  forced?: boolean;
  supervisor?: ServiceManagerKind | null;
}

export interface DaemonLifecycleOptions {
  /** Service context overrides (tests inject a fake runner/home), or false to ignore installed services. */
  service?: Partial<ServiceContext> | false;
  /** Bound for the graceful part of a stop and for startup readiness. */
  timeoutMs?: number;
}

export interface DaemonStartOptions extends DaemonLifecycleOptions {
  /** Port override for a detached start; a service-managed daemon always uses gateway.port. */
  port?: number;
}

export class DaemonPortInUseError extends Error {
  readonly code = "port_in_use";
  constructor(readonly port: number) {
    super(
      `Port ${port} is already in use by another process, so the mcpx gateway cannot start. ` +
      `Free the port, or choose another one by setting gateway.port in ${getConfigPath()} ` +
      `(or run "mcpx daemon run --port <port>" for a one-off foreground gateway). ` +
      "mcpx does not move the gateway to a different port on its own because every client is configured with this one."
    );
    this.name = "DaemonPortInUseError";
  }
}

const ALREADY_RUNNING_MESSAGE = "mcpx daemon already running.";
// Records written well before boot cannot belong to a live process (pid reuse after reboot).
const BOOT_SLACK_MS = 5 * 60 * 1000;
const LOG_ROTATE_INTERVAL_MS = 60 * 1000;

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

function activeSupervisor(options: DaemonLifecycleOptions | undefined): ServiceManager | null {
  if (options?.service === false) return null;
  const manager = findInstalledServiceManager(resolveServiceContext(options?.service || {}));
  return manager?.supervised ? manager : null;
}

function installedServiceKind(options?: DaemonLifecycleOptions): ServiceManagerKind | null {
  if (options?.service === false) return null;
  try {
    return findInstalledServiceManager(resolveServiceContext(options?.service || {}))?.kind ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Legacy pid file ("pid:port", written by the parent in older versions). Read
// only to recognise and clean up a daemon an older mcpx started.

interface LegacyPidRecord {
  pid: number;
  port: number | null;
  writtenAtMs: number;
}

function readLegacyPidRecord(): LegacyPidRecord | null {
  const pidPath = getPidPath();
  try {
    const raw = fs.readFileSync(pidPath, "utf8").trim();
    const [pidRaw, portRaw] = raw.split(":");
    const pid = Number(pidRaw);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    const port = portRaw ? Number(portRaw) : NaN;
    return { pid, port: Number.isInteger(port) && port > 0 ? port : null, writtenAtMs: fs.statSync(pidPath).mtimeMs };
  } catch {
    return null;
  }
}

function removeLegacyPidFile(): void {
  try { fs.unlinkSync(getPidPath()); } catch { /* none */ }
}

function legacyMayBeAlive(record: LegacyPidRecord): boolean {
  return isPidAlive(record.pid) && record.writtenAtMs >= bootTimeMs() - BOOT_SLACK_MS;
}

function terminateLegacy(pid: number): void {
  if (process.platform === "win32") {
    forceKill(pid);
    return;
  }
  try { process.kill(pid, "SIGTERM"); } catch { /* gone */ }
}

async function stopLegacyDaemon(timeoutMs: number): Promise<DaemonStopResult | null> {
  const record = readLegacyPidRecord();
  if (!record) {
    removeLegacyPidFile();
    return null;
  }
  if (!legacyMayBeAlive(record) || record.port === null || !(await looksLikeMcpxGateway(record.port))) {
    removeLegacyPidFile();
    return null;
  }
  terminateLegacy(record.pid);
  let stopped = await waitFor(() => !isPidAlive(record.pid), timeoutMs);
  const forced = !stopped && forceKill(record.pid);
  if (forced) stopped = await waitFor(() => !isPidAlive(record.pid), 3000) || forced;
  removeLegacyPidFile();
  return { stopped, forced, pid: record.pid, message: `Stopped legacy mcpx daemon (pid ${record.pid}).` };
}

function stopLegacyDaemonSync(timeoutMs: number): DaemonStopResult | null {
  const record = readLegacyPidRecord();
  if (!record) {
    removeLegacyPidFile();
    return null;
  }
  if (!legacyMayBeAlive(record) || record.port === null || !looksLikeMcpxGatewaySync(record.port)) {
    removeLegacyPidFile();
    return null;
  }
  terminateLegacy(record.pid);
  let stopped = waitForSync(() => !isPidAlive(record.pid), timeoutMs);
  const forced = !stopped && forceKill(record.pid);
  if (forced) stopped = waitForSync(() => !isPidAlive(record.pid), 3000) || forced;
  removeLegacyPidFile();
  return { stopped, forced, pid: record.pid, message: `Stopped legacy mcpx daemon (pid ${record.pid}).` };
}

// ---------------------------------------------------------------------------
// Status

/**
 * Fast, synchronous status from the daemon-owned runtime record, the pid,
 * the boot time and (POSIX) the presence of the control socket. It never
 * signals anything; use probeDaemonStatus() for an answer from the daemon.
 */
export function getDaemonStatus(config: McpxConfig): DaemonStatus {
  const base = { pidFile: getRuntimeRecordPath(), logFile: getLogPath(), service: installedServiceKind() };
  const record = readRuntimeRecord();
  if (record) {
    const running = isPidAlive(record.pid)
      && Date.parse(record.startedAt) >= bootTimeMs() - BOOT_SLACK_MS
      && (process.platform === "win32" || fs.existsSync(record.endpoint));
    return {
      ...base,
      running,
      pid: record.pid,
      port: record.port,
      portMismatch: running && record.port !== config.gateway.port,
      version: record.version,
      instanceId: record.instanceId,
      startedAt: record.startedAt,
      verified: false
    };
  }

  const legacy = readLegacyPidRecord();
  if (legacy) {
    const running = legacyMayBeAlive(legacy);
    const port = legacy.port ?? config.gateway.port;
    return { ...base, running, pid: legacy.pid, port, portMismatch: running && port !== config.gateway.port, legacy: true, verified: false };
  }

  return { ...base, running: false, port: config.gateway.port };
}

function statusFromPing(config: McpxConfig, ping: DaemonPing): DaemonStatus {
  const port = ping.port ?? config.gateway.port;
  return {
    pidFile: getRuntimeRecordPath(),
    logFile: getLogPath(),
    service: installedServiceKind(),
    running: true,
    pid: ping.pid,
    port,
    portMismatch: port !== config.gateway.port,
    version: ping.version,
    instanceId: ping.instanceId,
    startedAt: ping.startedAt,
    verified: true
  };
}

/** Status confirmed by the daemon itself over the control endpoint (version + instanceId). */
export async function probeDaemonStatus(config: McpxConfig): Promise<DaemonStatus> {
  const ping = await pingDaemon();
  if (ping) return statusFromPing(config, ping);
  const legacy = readLegacyPidRecord();
  if (legacy && legacy.port !== null && legacyMayBeAlive(legacy) && await looksLikeMcpxGateway(legacy.port)) {
    return { ...getDaemonStatus(config), running: true, legacy: true, verified: true };
  }
  return { pidFile: getRuntimeRecordPath(), logFile: getLogPath(), service: installedServiceKind(), running: false, port: config.gateway.port, verified: true };
}

// ---------------------------------------------------------------------------
// Start

async function waitForGatewayReady(port: number, token: string, timeoutMs = 15000): Promise<void> {
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

async function waitForReadyPing(timeoutMs: number, stopEarly: () => boolean = () => false): Promise<DaemonPing | null> {
  let found: DaemonPing | null = null;
  await waitFor(async () => {
    if (stopEarly()) return true;
    const ping = await pingDaemon(undefined, 500);
    if (ping?.ready) found = ping;
    return found !== null;
  }, timeoutMs);
  return found;
}

function alreadyRunning(ping: DaemonPing, config: McpxConfig, supervisor: ServiceManagerKind | null): DaemonStartResult {
  return {
    started: false,
    pid: ping.pid,
    port: ping.port ?? config.gateway.port,
    message: ALREADY_RUNNING_MESSAGE,
    version: ping.version,
    instanceId: ping.instanceId,
    supervisor
  };
}

async function startDaemonInner(config: McpxConfig, cliPath: string, secrets: SecretsManager, options: DaemonStartOptions): Promise<DaemonStartResult> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const supervisor = activeSupervisor(options);
  const supervisorKind = supervisor?.kind ?? null;

  const existing = await pingDaemon();
  if (existing) {
    return alreadyRunning(existing, config, supervisorKind);
  }
  // Starting while a daemon from an older mcpx holds the port: replace it.
  await stopLegacyDaemon(5000);

  const port = supervisor ? config.gateway.port : options.port ?? config.gateway.port;
  if (!(await isPortAvailable(port))) {
    throw new DaemonPortInUseError(port);
  }
  const token = ensureGatewayToken(config, secrets);

  const logPath = getLogPath();
  ensureParentDir(logPath);
  rotateLogIfNeeded(logPath);

  if (supervisor) {
    // The OS service manager owns the process; starting it ourselves would
    // race the supervisor (and lose to its single-instance guard anyway).
    const started = supervisor.start();
    if (!started.ok) {
      throw new Error(`Could not start the mcpx ${supervisor.kind} service: ${started.message}`);
    }
    const ping = await waitForReadyPing(timeoutMs);
    if (!ping) {
      throw new Error(`The ${supervisor.kind} service did not bring the mcpx daemon up within ${timeoutMs}ms. See ${logPath} and ${getServiceLogPath()}.`);
    }
    await waitForGatewayReady(ping.port ?? port, token);
    startBackgroundUpdateCheck();
    return {
      started: true,
      pid: ping.pid,
      port: ping.port ?? port,
      message: "mcpx daemon started.",
      version: ping.version,
      instanceId: ping.instanceId,
      supervisor: supervisorKind
    };
  }

  const logFd = fs.openSync(logPath, "a", 0o600);
  let child: ChildProcess;
  try {
    child = spawn(process.execPath, [cliPath, "daemon", "run", "--port", String(port)], {
      detached: true,
      windowsHide: true,
      stdio: ["ignore", logFd, logFd],
      env: buildDaemonChildEnv()
    });
  } finally {
    fs.closeSync(logFd);
  }
  let exitCode: number | null = null;
  let exited = false;
  child.once("exit", (code, signal) => {
    exited = true;
    exitCode = code ?? (signal ? -1 : null);
  });
  child.once("error", () => {
    exited = true;
  });
  child.unref();

  const ping = await waitForReadyPing(timeoutMs, () => exited);
  if (!ping) {
    if (exited && exitCode === DAEMON_EXIT_ALREADY_RUNNING) {
      const other = await pingDaemon();
      if (other) return alreadyRunning(other, config, null);
    }
    if (exited && exitCode === DAEMON_EXIT_PORT_IN_USE) {
      throw new DaemonPortInUseError(port);
    }
    if (!exited) forceKill(child.pid ?? -1);
    throw new Error(exited
      ? `mcpx daemon exited during startup (exit code ${exitCode ?? "unknown"}). See ${logPath}.`
      : `mcpx daemon did not become ready within ${timeoutMs}ms. See ${logPath}.`);
  }
  if (ping.pid !== child.pid) {
    // Lost a concurrent start; our child exits with DAEMON_EXIT_ALREADY_RUNNING.
    return alreadyRunning(ping, config, null);
  }

  startBackgroundUpdateCheck();
  await waitForGatewayReady(port, token);

  return {
    started: true,
    pid: ping.pid,
    port,
    message: "mcpx daemon started.",
    version: ping.version,
    instanceId: ping.instanceId,
    supervisor: null
  };
}

/**
 * Starts the gateway daemon. When an OS service is installed the service
 * manager starts it; otherwise a detached child is spawned. Either way the
 * result reflects the daemon's own identity, never a bare pid.
 */
export async function startDaemon(
  config: McpxConfig,
  cliPath: string,
  secrets: SecretsManager,
  options: DaemonStartOptions = {}
): Promise<DaemonStartResult> {
  const startedAt = Date.now();
  const result = await startDaemonInner(config, cliPath, secrets, options);
  captureTelemetryEvent({
    name: "operation_completed",
    properties: { operation: "daemon_start", outcome: "success", durationBucket: durationBucket(Date.now() - startedAt) }
  });
  return result;
}

// ---------------------------------------------------------------------------
// Stop

function notRunning(supervisor: ServiceManagerKind | null): DaemonStopResult {
  return { stopped: false, message: "mcpx daemon is not running.", supervisor };
}

function stoppedMessage(pid: number, forced: boolean): string {
  return `Stopped mcpx daemon (pid ${pid})${forced ? " after forcing it to exit" : ""}.`;
}

function recordTelemetry(operation: "daemon_stop", result: DaemonStopResult, startedAt: number): void {
  captureTelemetryEvent({
    name: "operation_completed",
    properties: {
      operation,
      outcome: result.stopped || result.message === "mcpx daemon is not running." ? "success" : "failure",
      ...(result.stopped || result.message === "mcpx daemon is not running." ? {} : { errorCode: "timeout" as const }),
      durationBucket: durationBucket(Date.now() - startedAt)
    }
  });
}

/** Removes identity files whose owner is gone (e.g. after a crash or kill -9). */
function removeStaleRecord(): void {
  const record = readRuntimeRecord();
  if (record && !isPidAlive(record.pid)) removeRuntimeRecord(record.instanceId);
}

/**
 * Verified stop: ask the daemon to shut down over the control channel, wait
 * (bounded) until its endpoint is gone and its pid has exited, escalate to
 * the service manager and then to a forced kill, and only then report.
 */
export async function stopDaemonAsync(options: DaemonLifecycleOptions = {}): Promise<DaemonStopResult> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 10_000;
  const supervisor = activeSupervisor(options);
  const supervisorKind = supervisor?.kind ?? null;

  const legacy = await stopLegacyDaemon(timeoutMs);
  const ping = await pingDaemon();
  if (!ping) {
    removeStaleRecord();
    const result = legacy ?? notRunning(supervisorKind);
    recordTelemetry("daemon_stop", result, startedAt);
    return result;
  }

  const gone = async () => !isPidAlive(ping.pid)
    || (readRuntimeRecord()?.instanceId !== ping.instanceId && !(await endpointIsLive(undefined, 500)));

  await requestShutdown(ping.instanceId);
  let stopped = await waitFor(gone, timeoutMs);
  if (!stopped && supervisor) {
    supervisor.stop();
    stopped = await waitFor(gone, 5000);
  }
  let forced = false;
  if (!stopped) {
    forced = forceKill(ping.pid);
    stopped = (await waitFor(() => !isPidAlive(ping.pid), 3000)) || forced;
  }
  if (stopped) removeRuntimeRecord(ping.instanceId);

  const result: DaemonStopResult = {
    stopped,
    pid: ping.pid,
    forced,
    supervisor: supervisorKind,
    message: stopped ? stoppedMessage(ping.pid, forced) : `Could not stop mcpx daemon (pid ${ping.pid}).`
  };
  recordTelemetry("daemon_stop", result, startedAt);
  return result;
}

/**
 * Synchronous form of stopDaemonAsync() for existing callers. It performs the
 * same verified sequence, using a short-lived helper process for the control
 * channel. Prefer stopDaemonAsync() where the caller can await.
 */
export function stopDaemon(options: DaemonLifecycleOptions = {}): DaemonStopResult {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 10_000;
  const supervisor = activeSupervisor(options);
  const supervisorKind = supervisor?.kind ?? null;

  const legacy = stopLegacyDaemonSync(timeoutMs);
  const ping = pingDaemonSync();
  if (!ping) {
    removeStaleRecord();
    const result = legacy ?? notRunning(supervisorKind);
    recordTelemetry("daemon_stop", result, startedAt);
    return result;
  }

  // The daemon removes its record and then closes the endpoint as its last
  // steps; checking that pair (not only the pid) also covers a zombie child
  // of this very process, which cannot be reaped while we block.
  const gone = () => !isPidAlive(ping.pid)
    || (readRuntimeRecord()?.instanceId !== ping.instanceId && pingDaemonSync(undefined, 500) === null);

  requestShutdownSync(ping.instanceId);
  let stopped = waitForSync(gone, timeoutMs);
  if (!stopped && supervisor) {
    supervisor.stop();
    stopped = waitForSync(gone, 5000);
  }
  let forced = false;
  if (!stopped) {
    forced = forceKill(ping.pid);
    stopped = waitForSync(() => !isPidAlive(ping.pid), 3000) || forced;
  }
  if (stopped) removeRuntimeRecord(ping.instanceId);

  const result: DaemonStopResult = {
    stopped,
    pid: ping.pid,
    forced,
    supervisor: supervisorKind,
    message: stopped ? stoppedMessage(ping.pid, forced) : `Could not stop mcpx daemon (pid ${ping.pid}).`
  };
  recordTelemetry("daemon_stop", result, startedAt);
  return result;
}

/** Verified stop, then start (through the service manager when one is installed). */
export async function restartDaemon(
  config: McpxConfig,
  cliPath: string,
  secrets: SecretsManager,
  options: DaemonStartOptions = {}
): Promise<DaemonStartResult> {
  const startedAt = Date.now();
  try {
    const stopped = await stopDaemonAsync(options);
    if (!stopped.stopped && stopped.pid !== undefined) {
      throw new Error(stopped.message);
    }
    const result = await startDaemon(config, cliPath, secrets, options);
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

// ---------------------------------------------------------------------------
// The daemon process itself

/** Supervised mode on every OS: the daemon writes its own output (no shell redirection needed). */
function redirectOutputToFile(logPath: string): void {
  ensureParentDir(logPath);
  const fd = fs.openSync(logPath, "a", 0o600);
  for (const stream of [process.stdout, process.stderr]) {
    stream.write = ((chunk: string | Uint8Array, encoding?: unknown, callback?: unknown) => {
      try {
        if (typeof chunk === "string") fs.writeSync(fd, chunk);
        else fs.writeSync(fd, chunk);
      } catch {
        // Logging must never crash the daemon.
      }
      const done = typeof encoding === "function" ? encoding : callback;
      if (typeof done === "function") (done as () => void)();
      return true;
    }) as typeof stream.write;
  }
}

function waitForListening(server: ReturnType<typeof createGatewayServer>): Promise<NodeJS.ErrnoException | null> {
  return new Promise((resolve) => {
    if (server.listening) {
      resolve(null);
      return;
    }
    const onListening = () => {
      server.off("error", onError);
      resolve(null);
    };
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      resolve(error);
    };
    server.once("listening", onListening);
    server.once("error", onError);
  });
}

function withTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    promise.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Runs the gateway in this process until asked to stop. Acquires the per-user
 * instance guard first (exiting with DAEMON_EXIT_ALREADY_RUNNING if another
 * daemon holds it), binds the port (exiting with DAEMON_EXIT_PORT_IN_USE if
 * something else holds it), then writes its own runtime record. Never
 * detaches; this is the entry point for both detached and supervised mode.
 */
export async function runDaemonForeground(config: McpxConfig, port: number, secrets: SecretsManager): Promise<void> {
  const ownLogFile = process.env[DAEMON_LOG_FILE_ENV];
  if (ownLogFile) redirectOutputToFile(ownLogFile);
  const supervised = process.env[SUPERVISED_ENV] === "1";

  let guard;
  try {
    guard = await acquireInstanceGuard(getControlEndpoint());
  } catch (error) {
    if (error instanceof DaemonAlreadyRunningError) {
      process.stderr.write(`mcpx: ${error.message} Not starting a second instance.\n`);
      process.exit(DAEMON_EXIT_ALREADY_RUNNING);
    }
    throw error;
  }

  const instanceId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  let ready = false;
  let shutdown: () => Promise<void> = async () => {};
  guard.setHandlers({
    ping: () => ({ ok: true, pid: process.pid, ready, version: APP_VERSION, instanceId, startedAt, port, supervised }),
    shutdown: () => void shutdown()
  });

  const token = ensureGatewayToken(config, secrets);
  const server = createGatewayServer({ port, expectedToken: token, secrets, instanceId });
  const listenError = await waitForListening(server);
  if (listenError) {
    await guard.close();
    if (listenError.code === "EADDRINUSE") {
      process.stderr.write(`mcpx: ${new DaemonPortInUseError(port).message}\n`);
      process.exit(DAEMON_EXIT_PORT_IN_USE);
    }
    throw listenError;
  }

  writeRuntimeRecord({
    schema: 1,
    pid: process.pid,
    port,
    version: APP_VERSION,
    startedAt,
    instanceId,
    endpoint: guard.endpoint,
    supervised
  });
  ready = true;

  const logToRotate = ownLogFile ?? getLogPath();
  const rotateTimer = setInterval(() => rotateLogIfNeeded(logToRotate), LOG_ROTATE_INTERVAL_MS);
  rotateTimer.unref();
  const stopMarketplaceUpdater = startMarketplaceAutoUpdater();

  return new Promise((resolve, reject) => {
    let shuttingDown = false;
    shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      // Hard ceiling: a stuck upstream must not keep the daemon alive.
      setTimeout(() => process.exit(0), 8000).unref();
      clearInterval(rotateTimer);
      stopMarketplaceUpdater();
      await withTimeout(server.shutdown(), 5000);
      removeRuntimeRecord(instanceId);
      await guard.close();
      resolve();
      // Exit even if a stray handle would keep the loop alive.
      setTimeout(() => process.exit(0), 1000).unref();
    };

    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());

    server.on("error", (error) => {
      reject(error);
    });
  });
}
