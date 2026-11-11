// One service manager per platform behind a common interface. File writes use
// real paths under ctx.homeDir; every OS command goes through ctx.runner.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getLogDir, getServiceDir, getServiceLogPath, homeDir } from "../core/paths.js";
import { LAUNCHD_LABEL, SYSTEMD_UNIT_NAME, WINDOWS_TASK_PREFIX, XDG_AUTOSTART_FILE } from "./constants.js";
import {
  encodeUtf16LeWithBom,
  renderLaunchdPlist,
  renderSystemdUnit,
  renderWindowsLauncher,
  renderWindowsTaskXml,
  renderXdgAutostartEntry,
  type ServiceProgram
} from "./definitions.js";
import { defaultCommandRunner, type CommandRecord, type CommandRunner } from "./runner.js";

export type ServiceManagerKind = "launchd" | "systemd" | "xdg-autostart" | "schtasks";

export interface ServiceContext {
  platform: NodeJS.Platform;
  homeDir: string;
  /** Used for XDG_CONFIG_HOME and Windows SystemRoot lookups. */
  env: NodeJS.ProcessEnv;
  uid: number | null;
  username: string;
  /** DOMAIN\user for the Windows logon trigger. */
  windowsUserId: string;
  runner: CommandRunner;
}

export function resolveServiceContext(overrides: Partial<ServiceContext> = {}): ServiceContext {
  const env = overrides.env ?? process.env;
  let username = overrides.username;
  if (!username) {
    try {
      username = os.userInfo().username;
    } catch {
      username = env.USER ?? env.USERNAME ?? "user";
    }
  }
  return {
    platform: overrides.platform ?? process.platform,
    homeDir: overrides.homeDir ?? homeDir(),
    env,
    uid: overrides.uid !== undefined ? overrides.uid : typeof process.getuid === "function" ? process.getuid() : null,
    username,
    windowsUserId: overrides.windowsUserId ?? (env.USERDOMAIN ? `${env.USERDOMAIN}\\${username}` : username),
    runner: overrides.runner ?? defaultCommandRunner
  };
}

export interface ManagerOpResult {
  ok: boolean;
  message: string;
  commands: CommandRecord[];
}

export interface ServiceManager {
  kind: ServiceManagerKind;
  /** Whether the OS restarts the daemon after a crash. */
  supervised: boolean;
  /** launchd label, systemd unit, autostart file or task name. */
  name: string;
  definitionPath: string;
  isInstalled(): boolean;
  install(program: ServiceProgram, options: { start: boolean }): ManagerOpResult;
  uninstall(): ManagerOpResult;
  start(): ManagerOpResult;
  /** Supervisor-level stop (the verified daemon stop lives in core/daemon.ts). */
  stop(): ManagerOpResult;
  /** Whether the OS currently has the service loaded/active; null when not knowable. */
  isLoaded(): boolean | null;
}

class CommandLog {
  readonly commands: CommandRecord[] = [];
  constructor(private readonly runner: CommandRunner) {}

  run(command: string, args: string[]): { code: number; stdout: string; stderr: string } {
    const result = this.runner(command, args);
    this.commands.push({ command, args, code: result.code, ...(result.stderr.trim() ? { stderr: result.stderr.trim() } : {}) });
    return result;
  }

  result(ok: boolean, message: string): ManagerOpResult {
    return { ok, message, commands: this.commands };
  }
}

function writeFileAtomic(filePath: string, content: string | Buffer, mode = 0o644): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temp, content, { mode });
  fs.renameSync(temp, filePath);
}

function removeFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Already gone.
  }
}

function failure(log: CommandLog, what: string): ManagerOpResult {
  const last = log.commands[log.commands.length - 1];
  const detail = last ? ` (${[last.command, ...last.args].join(" ")} exited ${last.code}${last.stderr ? `: ${last.stderr}` : ""})` : "";
  return log.result(false, `${what} failed${detail}.`);
}

// ---------------------------------------------------------------------------

export function createLaunchdManager(ctx: ServiceContext): ServiceManager {
  const definitionPath = path.join(ctx.homeDir, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
  const domain = `gui/${ctx.uid ?? 0}`;
  const target = `${domain}/${LAUNCHD_LABEL}`;
  const isLoaded = () => ctx.runner("launchctl", ["print", target]).code === 0;

  return {
    kind: "launchd",
    supervised: true,
    name: LAUNCHD_LABEL,
    definitionPath,
    isInstalled: () => fs.existsSync(definitionPath),
    isLoaded,
    install(program, options) {
      const log = new CommandLog(ctx.runner);
      fs.mkdirSync(getLogDir(), { recursive: true });
      writeFileAtomic(definitionPath, renderLaunchdPlist({
        label: LAUNCHD_LABEL,
        program,
        workingDirectory: ctx.homeDir,
        stdoutPath: getServiceLogPath(),
        stderrPath: getServiceLogPath()
      }));
      // Replace any previously loaded definition; not loaded is fine.
      log.run("launchctl", ["bootout", target]);
      if (!options.start) return log.result(true, `Installed ${definitionPath}; it loads at next login.`);
      log.run("launchctl", ["enable", target]);
      if (log.run("launchctl", ["bootstrap", domain, definitionPath]).code !== 0) return failure(log, "launchctl bootstrap");
      return log.result(true, `Installed and loaded ${LAUNCHD_LABEL}.`);
    },
    uninstall() {
      const log = new CommandLog(ctx.runner);
      log.run("launchctl", ["bootout", target]);
      removeFile(definitionPath);
      return log.result(true, `Removed ${LAUNCHD_LABEL}.`);
    },
    start() {
      const log = new CommandLog(ctx.runner);
      if (log.run("launchctl", ["print", target]).code !== 0) {
        log.run("launchctl", ["enable", target]);
        if (log.run("launchctl", ["bootstrap", domain, definitionPath]).code !== 0) return failure(log, "launchctl bootstrap");
      }
      if (log.run("launchctl", ["kickstart", target]).code !== 0) return failure(log, "launchctl kickstart");
      return log.result(true, `Started ${LAUNCHD_LABEL}.`);
    },
    stop() {
      const log = new CommandLog(ctx.runner);
      // bootout signals the job (SIGTERM, then SIGKILL after its exit timeout)
      // and unloads it so KeepAlive cannot restart it; it reloads at next login.
      log.run("launchctl", ["bootout", target]);
      return log.result(true, `Stopped ${LAUNCHD_LABEL}.`);
    }
  };
}

function xdgConfigHome(ctx: ServiceContext): string {
  const configured = ctx.env.XDG_CONFIG_HOME;
  return configured && path.isAbsolute(configured) ? configured : path.join(ctx.homeDir, ".config");
}

export function createSystemdManager(ctx: ServiceContext): ServiceManager {
  const definitionPath = path.join(xdgConfigHome(ctx), "systemd", "user", SYSTEMD_UNIT_NAME);
  const systemctl = (log: CommandLog, ...args: string[]) => log.run("systemctl", ["--user", ...args]);

  return {
    kind: "systemd",
    supervised: true,
    name: SYSTEMD_UNIT_NAME,
    definitionPath,
    isInstalled: () => fs.existsSync(definitionPath),
    isLoaded: () => ctx.runner("systemctl", ["--user", "is-active", "--quiet", SYSTEMD_UNIT_NAME]).code === 0,
    install(program, options) {
      const log = new CommandLog(ctx.runner);
      writeFileAtomic(definitionPath, renderSystemdUnit({
        description: "mcpx MCP gateway",
        program,
        workingDirectory: ctx.homeDir
      }));
      if (systemctl(log, "daemon-reload").code !== 0) return failure(log, "systemctl daemon-reload");
      const enable = options.start ? ["enable", "--now", SYSTEMD_UNIT_NAME] : ["enable", SYSTEMD_UNIT_NAME];
      if (systemctl(log, ...enable).code !== 0) return failure(log, "systemctl enable");
      return log.result(true, `Installed and enabled ${SYSTEMD_UNIT_NAME}.`);
    },
    uninstall() {
      const log = new CommandLog(ctx.runner);
      systemctl(log, "disable", "--now", SYSTEMD_UNIT_NAME);
      removeFile(definitionPath);
      systemctl(log, "daemon-reload");
      return log.result(true, `Removed ${SYSTEMD_UNIT_NAME}.`);
    },
    start() {
      const log = new CommandLog(ctx.runner);
      if (systemctl(log, "start", SYSTEMD_UNIT_NAME).code !== 0) return failure(log, "systemctl start");
      return log.result(true, `Started ${SYSTEMD_UNIT_NAME}.`);
    },
    stop() {
      const log = new CommandLog(ctx.runner);
      if (systemctl(log, "stop", SYSTEMD_UNIT_NAME).code !== 0) return failure(log, "systemctl stop");
      return log.result(true, `Stopped ${SYSTEMD_UNIT_NAME}.`);
    }
  };
}

export function createXdgAutostartManager(ctx: ServiceContext): ServiceManager {
  const definitionPath = path.join(xdgConfigHome(ctx), "autostart", XDG_AUTOSTART_FILE);
  const unsupervised = (): ManagerOpResult => ({
    ok: false,
    message: "An XDG autostart entry has no service manager; the daemon is started and stopped directly.",
    commands: []
  });
  return {
    kind: "xdg-autostart",
    supervised: false,
    name: XDG_AUTOSTART_FILE,
    definitionPath,
    isInstalled: () => fs.existsSync(definitionPath),
    isLoaded: () => null,
    install(program) {
      writeFileAtomic(definitionPath, renderXdgAutostartEntry({
        name: "mcpx gateway",
        comment: "mcpx MCP gateway daemon",
        program
      }));
      return { ok: true, message: `Installed autostart entry ${definitionPath}; it takes effect at next login.`, commands: [] };
    },
    uninstall() {
      removeFile(definitionPath);
      return { ok: true, message: `Removed autostart entry ${definitionPath}.`, commands: [] };
    },
    start: unsupervised,
    stop: unsupervised
  };
}

export function windowsTaskName(username: string): string {
  return `${WINDOWS_TASK_PREFIX}-${username.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

export function createSchtasksManager(ctx: ServiceContext): ServiceManager {
  const taskName = windowsTaskName(ctx.username);
  const serviceDir = getServiceDir();
  const definitionPath = path.join(serviceDir, `${WINDOWS_TASK_PREFIX}.xml`);
  const launcherPath = path.join(serviceDir, `${WINDOWS_TASK_PREFIX}.vbs`);
  const systemRoot = ctx.env.SystemRoot ?? ctx.env.SYSTEMROOT ?? "C:\\Windows";

  return {
    kind: "schtasks",
    supervised: true,
    name: taskName,
    definitionPath,
    isInstalled: () => fs.existsSync(definitionPath),
    isLoaded: () => ctx.runner("schtasks", ["/Query", "/TN", taskName]).code === 0,
    install(program, options) {
      const log = new CommandLog(ctx.runner);
      writeFileAtomic(launcherPath, encodeUtf16LeWithBom(renderWindowsLauncher({ program })));
      writeFileAtomic(definitionPath, encodeUtf16LeWithBom(renderWindowsTaskXml({
        description: "mcpx MCP gateway (per-user, starts at logon)",
        userId: ctx.windowsUserId,
        wscriptPath: `${systemRoot}\\System32\\wscript.exe`,
        launcherPath,
        workingDirectory: ctx.homeDir
      })));
      if (log.run("schtasks", ["/Create", "/TN", taskName, "/XML", definitionPath, "/F"]).code !== 0) {
        return failure(log, "schtasks /Create");
      }
      if (options.start && log.run("schtasks", ["/Run", "/TN", taskName]).code !== 0) return failure(log, "schtasks /Run");
      return log.result(true, `Installed scheduled task ${taskName}.`);
    },
    uninstall() {
      const log = new CommandLog(ctx.runner);
      log.run("schtasks", ["/End", "/TN", taskName]);
      log.run("schtasks", ["/Delete", "/TN", taskName, "/F"]);
      removeFile(definitionPath);
      removeFile(launcherPath);
      return log.result(true, `Removed scheduled task ${taskName}.`);
    },
    start() {
      const log = new CommandLog(ctx.runner);
      if (log.run("schtasks", ["/Run", "/TN", taskName]).code !== 0) return failure(log, "schtasks /Run");
      return log.result(true, `Started scheduled task ${taskName}.`);
    },
    stop() {
      const log = new CommandLog(ctx.runner);
      log.run("schtasks", ["/End", "/TN", taskName]);
      return log.result(true, `Ended scheduled task ${taskName}.`);
    }
  };
}

export function systemdUserAvailable(ctx: ServiceContext): boolean {
  return ctx.runner("systemctl", ["--user", "show-environment"]).code === 0;
}

/**
 * The manager whose definition is installed, if any — no OS commands, only
 * file checks, so it is cheap enough for every start/stop/status call.
 */
export function findInstalledServiceManager(ctx: ServiceContext): ServiceManager | null {
  const candidates = ctx.platform === "darwin"
    ? [createLaunchdManager(ctx)]
    : ctx.platform === "win32"
      ? [createSchtasksManager(ctx)]
      : [createSystemdManager(ctx), createXdgAutostartManager(ctx)];
  return candidates.find((manager) => manager.isInstalled()) ?? null;
}

/** The manager installService should use on this host. */
export function selectServiceManager(ctx: ServiceContext): { manager: ServiceManager; warnings: string[] } {
  const installed = findInstalledServiceManager(ctx);
  if (installed) return { manager: installed, warnings: [] };
  if (ctx.platform === "darwin") return { manager: createLaunchdManager(ctx), warnings: [] };
  if (ctx.platform === "win32") return { manager: createSchtasksManager(ctx), warnings: [] };
  if (systemdUserAvailable(ctx)) return { manager: createSystemdManager(ctx), warnings: [] };
  return {
    manager: createXdgAutostartManager(ctx),
    warnings: ["systemd --user is not available; installed an XDG autostart entry instead. The daemon starts at login but is not restarted if it crashes."]
  };
}
