// Public API of the OS background-service layer: register the gateway daemon
// as a per-user service (launchd / systemd --user / Task Scheduler, with an
// XDG autostart fallback) and manage it.
import { getLogPath } from "../core/paths.js";
import { stopDaemonAsync } from "../core/daemon.js";
import { pingDaemon, type DaemonPing } from "./endpoint.js";
import {
  findInstalledServiceManager,
  resolveServiceContext,
  selectServiceManager,
  type ServiceContext,
  type ServiceManager,
  type ServiceManagerKind
} from "./managers.js";
import { resolveServiceProgram } from "./runtime.js";
import type { CommandRecord } from "./runner.js";
import { waitFor } from "./process.js";

export type ServiceAction = "install" | "uninstall" | "start" | "stop" | "restart" | "status";

export interface ServiceResult {
  ok: boolean;
  action: ServiceAction;
  /** null when no service is installed and none was selected. */
  manager: ServiceManagerKind | null;
  installed: boolean;
  /** Whether the OS restarts the daemon after a crash (false for the XDG autostart fallback). */
  restartOnCrash: boolean;
  /** Verified by the daemon itself over the control endpoint. */
  running: boolean;
  pid?: number;
  port?: number;
  version?: string;
  instanceId?: string;
  definitionPath?: string;
  message: string;
  warnings: string[];
  /** OS commands that were run, for diagnostics. */
  commands: CommandRecord[];
}

export interface ServiceStatus extends ServiceResult {
  action: "status";
  /** Whether the OS reports the service loaded/active; null when unknown or not installed. */
  loaded: boolean | null;
}

export interface ServiceOptions {
  /** Overrides for tests: platform, home, injected command runner, user ids. */
  context?: Partial<ServiceContext>;
  /** How long to wait for the daemon to come up or go down. */
  timeoutMs?: number;
}

export interface ServiceInstallOptions extends ServiceOptions {
  /** Absolute path of the cli.js the service runs ("daemon run"). */
  cliPath: string;
  /** Runtime for cli.js. Defaults to process.execPath. */
  execPath?: string;
  /** Whether execPath is Electron (sets ELECTRON_RUN_AS_NODE=1). Defaults to detection. */
  electron?: boolean;
  /** Start the service now (default true). */
  start?: boolean;
}

function daemonFields(ping: DaemonPing | null): Pick<ServiceResult, "running" | "pid" | "port" | "version" | "instanceId"> {
  return ping
    ? { running: true, pid: ping.pid, port: ping.port, version: ping.version, instanceId: ping.instanceId }
    : { running: false };
}

function baseResult(action: ServiceAction, manager: ServiceManager | null): Omit<ServiceResult, "ok" | "message" | "running"> {
  return {
    action,
    manager: manager?.kind ?? null,
    installed: manager?.isInstalled() ?? false,
    restartOnCrash: manager?.supervised ?? false,
    definitionPath: manager?.definitionPath,
    warnings: [],
    commands: []
  };
}

async function waitForDaemon(timeoutMs: number): Promise<DaemonPing | null> {
  let found: DaemonPing | null = null;
  await waitFor(async () => {
    const ping = await pingDaemon(undefined, 500);
    if (ping?.ready) found = ping;
    return found !== null;
  }, timeoutMs, 200);
  return found;
}

function notInstalled(action: ServiceAction): ServiceResult {
  return { ...baseResult(action, null), ok: false, running: false, message: "The mcpx service is not installed." };
}

/**
 * Writes the service definition for this OS, registers it with the service
 * manager and (by default) starts it. A daemon that is already running
 * outside the service is stopped first so the two cannot fight over the
 * instance guard.
 */
export async function installService(options: ServiceInstallOptions): Promise<ServiceResult> {
  const ctx = resolveServiceContext(options.context);
  const { manager, warnings } = selectServiceManager(ctx);
  const program = resolveServiceProgram({
    cliPath: options.cliPath,
    execPath: options.execPath,
    electron: options.electron,
    platform: ctx.platform,
    env: ctx.env,
    logFile: getLogPath()
  });
  const start = options.start ?? true;
  const timeoutMs = options.timeoutMs ?? 15_000;

  if (start && manager.supervised) {
    const stopped = await stopDaemonAsync({ service: false, timeoutMs });
    if (stopped.pid !== undefined && !stopped.stopped) {
      return { ...baseResult("install", manager), ok: false, running: true, pid: stopped.pid, message: `A running mcpx daemon could not be stopped before installing the service: ${stopped.message}`, warnings };
    }
  }

  const op = manager.install(program, { start: start && manager.supervised });
  const ping = op.ok && start && manager.supervised ? await waitForDaemon(timeoutMs) : await pingDaemon();
  const result: ServiceResult = {
    ...baseResult("install", manager),
    ok: op.ok,
    ...daemonFields(ping),
    message: op.message,
    warnings: [...warnings],
    commands: op.commands
  };
  if (op.ok && start && manager.supervised && !ping) {
    result.warnings.push(`The service was registered but the daemon did not answer within ${timeoutMs}ms; check ${getLogPath()}.`);
  }
  return result;
}

/** Unregisters the service (which stops a service-run daemon) and removes its definition. */
export async function uninstallService(options: ServiceOptions = {}): Promise<ServiceResult> {
  const ctx = resolveServiceContext(options.context);
  const manager = findInstalledServiceManager(ctx);
  if (!manager) return notInstalled("uninstall");
  const op = manager.uninstall();
  const warnings: string[] = [];
  if (manager.supervised) {
    // The supervisor normally stopped it; make sure nothing is left behind.
    await stopDaemonAsync({ service: false, timeoutMs: options.timeoutMs ?? 10_000 });
  } else {
    warnings.push("Removed the autostart entry; a daemon that is already running keeps running until stopped.");
  }
  return { ...baseResult("uninstall", manager), installed: manager.isInstalled(), ok: op.ok, ...daemonFields(await pingDaemon()), message: op.message, warnings, commands: op.commands };
}

export async function getServiceStatus(options: ServiceOptions = {}): Promise<ServiceStatus> {
  const ctx = resolveServiceContext(options.context);
  const manager = findInstalledServiceManager(ctx);
  const ping = await pingDaemon();
  if (!manager) {
    return { ...notInstalled("status"), action: "status", ok: true, loaded: null, ...daemonFields(ping) };
  }
  const loaded = manager.isLoaded();
  return {
    ...baseResult("status", manager),
    action: "status",
    ok: true,
    loaded,
    ...daemonFields(ping),
    message: ping
      ? `mcpx ${manager.kind} service installed; daemon running (pid ${ping.pid}).`
      : `mcpx ${manager.kind} service installed; daemon not running.`
  };
}

/** Starts the installed service through the OS service manager and waits for the daemon. */
export async function startService(options: ServiceOptions = {}): Promise<ServiceResult> {
  const ctx = resolveServiceContext(options.context);
  const manager = findInstalledServiceManager(ctx);
  if (!manager) return notInstalled("start");
  if (!manager.supervised) {
    return { ...baseResult("start", manager), ok: false, ...daemonFields(await pingDaemon()), message: "The XDG autostart entry has no service manager; use startDaemon() to start the daemon now." };
  }
  const existing = await pingDaemon();
  if (existing) {
    return { ...baseResult("start", manager), ok: true, ...daemonFields(existing), message: "mcpx daemon already running." };
  }
  const op = manager.start();
  const ping = op.ok ? await waitForDaemon(options.timeoutMs ?? 15_000) : null;
  return {
    ...baseResult("start", manager),
    ok: op.ok && ping !== null,
    ...daemonFields(ping),
    message: op.ok && !ping ? `${op.message} The daemon did not answer in time; check ${getLogPath()}.` : op.message,
    commands: op.commands
  };
}

/** Verified stop of the service-run daemon; it stays registered and starts again at next login. */
export async function stopService(options: ServiceOptions = {}): Promise<ServiceResult> {
  const ctx = resolveServiceContext(options.context);
  const manager = findInstalledServiceManager(ctx);
  if (!manager) return notInstalled("stop");
  const stopped = await stopDaemonAsync({ service: options.context ?? {}, timeoutMs: options.timeoutMs });
  return {
    ...baseResult("stop", manager),
    ok: stopped.stopped || stopped.pid === undefined,
    ...daemonFields(await pingDaemon()),
    message: stopped.message
  };
}

export async function restartService(options: ServiceOptions = {}): Promise<ServiceResult> {
  const stopped = await stopService(options);
  if (!stopped.ok) return { ...stopped, action: "restart" };
  const started = await startService(options);
  return { ...started, action: "restart", commands: [...stopped.commands, ...started.commands] };
}

export { resolveServiceProgram } from "./runtime.js";
export type { ResolveServiceProgramOptions } from "./runtime.js";
export {
  renderLaunchdPlist,
  renderSystemdUnit,
  renderWindowsLauncher,
  renderWindowsTaskXml,
  renderXdgAutostartEntry
} from "./definitions.js";
export type { ServiceProgram } from "./definitions.js";
export type { ServiceContext, ServiceManagerKind } from "./managers.js";
export type { CommandRecord, CommandRunner, RunResult } from "./runner.js";
export {
  DAEMON_EXIT_ALREADY_RUNNING,
  DAEMON_EXIT_PORT_IN_USE,
  LAUNCHD_LABEL,
  SYSTEMD_UNIT_NAME
} from "./constants.js";
