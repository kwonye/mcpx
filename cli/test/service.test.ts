// Service layer: pure definition generators for all three platforms (run on
// any host), the per-platform command sequences through an injected runner,
// and the public API end to end with a fake supervisor that launches a real
// daemon child in a temp home. No real launchd/systemd/Task Scheduler use.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it } from "bun:test";
import { defaultConfig, saveConfig } from "../src/core/config.js";
import { stopDaemonAsync } from "../src/core/daemon.js";
import { getControlEndpoint, getServiceDir, getServiceLogPath } from "../src/core/paths.js";
import { LAUNCHD_LABEL } from "../src/service/constants.js";
import {
  renderLaunchdPlist,
  renderSystemdUnit,
  renderWindowsLauncher,
  renderWindowsTaskXml,
  renderXdgAutostartEntry,
  type ServiceProgram
} from "../src/service/definitions.js";
import { pingDaemon } from "../src/service/endpoint.js";
import {
  getServiceStatus,
  installService,
  restartService,
  startService,
  stopService,
  uninstallService
} from "../src/service/index.js";
import {
  createLaunchdManager,
  createSchtasksManager,
  createSystemdManager,
  createXdgAutostartManager,
  resolveServiceContext,
  windowsTaskName,
  type ServiceContext
} from "../src/service/managers.js";
import { isPidAlive, waitFor } from "../src/service/process.js";
import { quoteDesktopExecArg, quoteSystemdArg, quoteWindowsArg } from "../src/service/quote.js";
import type { CommandRunner } from "../src/service/runner.js";
import { resolveServiceProgram } from "../src/service/runtime.js";
import { setupTempEnv } from "./helpers.js";

const CLI_PATH = path.join(import.meta.dir, "..", "src", "cli.ts");

describe("service definitions (pure)", () => {
  const macProgram: ServiceProgram = {
    command: "/Applications/mcpx Desktop.app/Contents/MacOS/mcpx",
    args: ["/Applications/mcpx Desktop.app/Contents/Resources/cli/dist/cli.js", "daemon", "run"],
    env: { MCPX_SUPERVISED: "1", ELECTRON_RUN_AS_NODE: "1", WEIRD: "a&b<c>\"'" }
  };

  it("renders the launchd LaunchAgent plist", () => {
    expect(renderLaunchdPlist({
      label: LAUNCHD_LABEL,
      program: macProgram,
      workingDirectory: "/Users/a b",
      stdoutPath: "/Users/a b/.local/state/mcpx/logs/service.log",
      stderrPath: "/Users/a b/.local/state/mcpx/logs/service.log"
    })).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>io.github.kwonye.mcpx.gateway</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Applications/mcpx Desktop.app/Contents/MacOS/mcpx</string>
    <string>/Applications/mcpx Desktop.app/Contents/Resources/cli/dist/cli.js</string>
    <string>daemon</string>
    <string>run</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ELECTRON_RUN_AS_NODE</key>
    <string>1</string>
    <key>MCPX_SUPERVISED</key>
    <string>1</string>
    <key>WEIRD</key>
    <string>a&amp;b&lt;c&gt;&quot;&apos;</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>/Users/a b</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>/Users/a b/.local/state/mcpx/logs/service.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/a b/.local/state/mcpx/logs/service.log</string>
</dict>
</plist>
`);
  });

  const linuxProgram: ServiceProgram = {
    command: "/home/a b/.nvm/versions/node/v22/bin/node",
    args: ["/home/a b/lib/node_modules/@kwonye/mcpx/dist/cli.js", "daemon", "run"],
    env: { PERCENT: "100%$HOME\"q\\", MCPX_SUPERVISED: "1" }
  };

  it("renders the systemd user unit with quoted paths and escaped specifiers", () => {
    expect(renderSystemdUnit({ description: "mcpx MCP gateway", program: linuxProgram, workingDirectory: "/home/a b" })).toBe(`[Unit]
Description=mcpx MCP gateway
StartLimitIntervalSec=300
StartLimitBurst=10

[Service]
Type=simple
ExecStart="/home/a b/.nvm/versions/node/v22/bin/node" "/home/a b/lib/node_modules/@kwonye/mcpx/dist/cli.js" "daemon" "run"
WorkingDirectory="/home/a b"
Environment="MCPX_SUPERVISED=1"
Environment="PERCENT=100%%$HOME\\"q\\\\"
Restart=on-failure
RestartSec=5
RestartPreventExitStatus=75
TimeoutStopSec=15

[Install]
WantedBy=default.target
`);
  });

  it("renders the XDG autostart fallback entry", () => {
    expect(renderXdgAutostartEntry({ name: "mcpx gateway", comment: "mcpx MCP gateway daemon", program: linuxProgram })).toBe(`[Desktop Entry]
Type=Application
Name=mcpx gateway
Comment=mcpx MCP gateway daemon
Exec=env MCPX_SUPERVISED=1 "PERCENT=100%%\\\\$HOME\\\\"q\\\\\\\\" "/home/a b/.nvm/versions/node/v22/bin/node" "/home/a b/lib/node_modules/@kwonye/mcpx/dist/cli.js" daemon run
Terminal=false
NoDisplay=true
X-GNOME-Autostart-enabled=true
`);
  });

  const windowsProgram: ServiceProgram = {
    command: "C:\\Program Files\\nodejs\\node.exe",
    args: ["C:\\Users\\A B\\AppData\\Roaming\\npm\\node_modules\\@kwonye\\mcpx\\dist\\cli.js", "daemon", "run"],
    env: { MCPX_SUPERVISED: "1", MCPX_DAEMON_LOG_FILE: "C:\\Users\\A B\\.local\\state\\mcpx\\logs\\daemon.log" }
  };

  it("renders the Windows hidden launcher with a relaunch-on-failure loop", () => {
    expect(renderWindowsLauncher({ program: windowsProgram })).toBe([
      "' Generated by mcpx. Launches the mcpx gateway daemon hidden and relaunches it on failure.",
      "Option Explicit",
      "Dim shell, procEnv, commandLine, exitCode, delay, started",
      "Set shell = CreateObject(\"WScript.Shell\")",
      "Set procEnv = shell.Environment(\"PROCESS\")",
      "procEnv(\"MCPX_DAEMON_LOG_FILE\") = \"C:\\Users\\A B\\.local\\state\\mcpx\\logs\\daemon.log\"",
      "procEnv(\"MCPX_SUPERVISED\") = \"1\"",
      "commandLine = \"\"\"C:\\Program Files\\nodejs\\node.exe\"\" \"\"C:\\Users\\A B\\AppData\\Roaming\\npm\\node_modules\\@kwonye\\mcpx\\dist\\cli.js\"\" \"\"daemon\"\" \"\"run\"\"\"",
      "delay = 5",
      "Do",
      "  started = Now",
      "  exitCode = shell.Run(commandLine, 0, True)",
      "  If exitCode = 0 Or exitCode = 75 Then Exit Do",
      "  If DateDiff(\"s\", started, Now) > 60 Then delay = 5",
      "  WScript.Sleep delay * 1000",
      "  delay = delay * 2",
      "  If delay > 60 Then delay = 60",
      "Loop",
      "WScript.Quit exitCode",
      ""
    ].join("\r\n"));
  });

  it("renders the Task Scheduler XML: per-user logon trigger, least privilege, hidden", () => {
    const xml = renderWindowsTaskXml({
      description: "mcpx MCP gateway (per-user, starts at logon)",
      userId: "DESKTOP-1\\A B",
      wscriptPath: "C:\\Windows\\System32\\wscript.exe",
      launcherPath: "C:\\Users\\A B\\.local\\share\\mcpx\\service\\mcpx-gateway.vbs",
      workingDirectory: "C:\\Users\\A B"
    });
    expect(xml).toBe([
      "<?xml version=\"1.0\" encoding=\"UTF-16\"?>",
      "<Task version=\"1.2\" xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\">",
      "  <RegistrationInfo>",
      "    <Description>mcpx MCP gateway (per-user, starts at logon)</Description>",
      "  </RegistrationInfo>",
      "  <Triggers>",
      "    <LogonTrigger>",
      "      <Enabled>true</Enabled>",
      "      <UserId>DESKTOP-1\\A B</UserId>",
      "    </LogonTrigger>",
      "  </Triggers>",
      "  <Principals>",
      "    <Principal id=\"Author\">",
      "      <UserId>DESKTOP-1\\A B</UserId>",
      "      <LogonType>InteractiveToken</LogonType>",
      "      <RunLevel>LeastPrivilege</RunLevel>",
      "    </Principal>",
      "  </Principals>",
      "  <Settings>",
      "    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>",
      "    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>",
      "    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>",
      "    <AllowHardTerminate>true</AllowHardTerminate>",
      "    <StartWhenAvailable>true</StartWhenAvailable>",
      "    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>",
      "    <IdleSettings>",
      "      <StopOnIdleEnd>false</StopOnIdleEnd>",
      "      <RestartOnIdle>false</RestartOnIdle>",
      "    </IdleSettings>",
      "    <AllowStartOnDemand>true</AllowStartOnDemand>",
      "    <Enabled>true</Enabled>",
      "    <Hidden>true</Hidden>",
      "    <RunOnlyIfIdle>false</RunOnlyIfIdle>",
      "    <WakeToRun>false</WakeToRun>",
      "    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>",
      "    <Priority>7</Priority>",
      "    <RestartOnFailure>",
      "      <Interval>PT1M</Interval>",
      "      <Count>3</Count>",
      "    </RestartOnFailure>",
      "  </Settings>",
      "  <Actions Context=\"Author\">",
      "    <Exec>",
      "      <Command>C:\\Windows\\System32\\wscript.exe</Command>",
      "      <Arguments>//B //Nologo &quot;C:\\Users\\A B\\.local\\share\\mcpx\\service\\mcpx-gateway.vbs&quot;</Arguments>",
      "      <WorkingDirectory>C:\\Users\\A B</WorkingDirectory>",
      "    </Exec>",
      "  </Actions>",
      "</Task>",
      ""
    ].join("\r\n"));
  });

  it("quotes arguments with spaces, quotes and backslashes for every platform", () => {
    expect(quoteWindowsArg("C:\\Program Files\\node.exe")).toBe("\"C:\\Program Files\\node.exe\"");
    expect(quoteWindowsArg("C:\\dir with space\\")).toBe("\"C:\\dir with space\\\\\"");
    expect(quoteWindowsArg("say \"hi\"")).toBe("\"say \\\"hi\\\"\"");
    expect(quoteWindowsArg("a\\\"b")).toBe("\"a\\\\\\\"b\"");
    expect(quoteSystemdArg("/opt/my app/node")).toBe("\"/opt/my app/node\"");
    expect(quoteSystemdArg("50%$x")).toBe("\"50%%$$x\"");
    expect(quoteDesktopExecArg("/opt/my app/node")).toBe("\"/opt/my app/node\"");
    expect(quoteDesktopExecArg("/usr/bin/node")).toBe("/usr/bin/node");
    expect(() => quoteSystemdArg("a\nb")).toThrow();
    expect(() => renderSystemdUnit({ description: "x", program: { command: "/a", args: [], env: { "BAD NAME": "1" } }, workingDirectory: "/" })).toThrow();
  });
});

describe("service program resolution", () => {
  it("uses absolute runtime + cli.js and sets ELECTRON_RUN_AS_NODE for an Electron runtime", () => {
    const program = resolveServiceProgram({
      cliPath: "/Applications/mcpx.app/Contents/Resources/cli/dist/cli.js",
      execPath: "/Applications/mcpx.app/Contents/MacOS/mcpx",
      electron: true,
      platform: "darwin",
      env: { PATH: "/usr/bin", MCPX_STATE_HOME: "/custom/state" },
      logFile: "/Users/a/.local/state/mcpx/logs/daemon.log",
      exists: () => true
    });
    expect(program.command).toBe("/Applications/mcpx.app/Contents/MacOS/mcpx");
    expect(program.args).toEqual(["/Applications/mcpx.app/Contents/Resources/cli/dist/cli.js", "daemon", "run"]);
    expect(program.env).toMatchObject({
      ELECTRON_RUN_AS_NODE: "1",
      MCPX_DAEMON_CHILD: "1",
      MCPX_SUPERVISED: "1",
      MCPX_DAEMON_LOG_FILE: "/Users/a/.local/state/mcpx/logs/daemon.log",
      MCPX_STATE_HOME: "/custom/state"
    });
    expect(program.env.PATH?.split(":")[0]).toBe("/usr/bin");
  });

  it("omits the Electron flag for node and PATH on Windows; rejects relative or missing paths", () => {
    const program = resolveServiceProgram({
      cliPath: "C:\\Users\\A B\\mcpx\\cli.js",
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      electron: false,
      platform: "win32",
      env: { PATH: "C:\\Windows" },
      logFile: "C:\\log.txt",
      exists: () => true
    });
    expect(program.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(program.env.PATH).toBeUndefined();
    expect(() => resolveServiceProgram({ cliPath: "dist/cli.js", execPath: "/usr/bin/node", platform: "linux", logFile: "/l", exists: () => true })).toThrow("must be absolute");
    expect(() => resolveServiceProgram({ cliPath: "/missing/cli.js", execPath: "/usr/bin/node", platform: "linux", logFile: "/l", exists: () => false })).toThrow("does not exist");
  });
});

// ---------------------------------------------------------------------------

interface FakeRunner {
  runner: CommandRunner;
  calls: string[];
}

function fakeRunner(respond: (command: string, args: string[]) => number = () => 0): FakeRunner {
  const calls: string[] = [];
  return {
    calls,
    runner: (command, args) => {
      calls.push([command, ...args].join(" "));
      return { code: respond(command, args), stdout: "", stderr: "" };
    }
  };
}

const program: ServiceProgram = { command: "/usr/bin/node", args: ["/opt/mcpx/cli.js", "daemon", "run"], env: { MCPX_SUPERVISED: "1" } };

describe("service managers (injected runner)", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
  });

  function context(platform: NodeJS.Platform, fake: FakeRunner): ServiceContext {
    const env = setupTempEnv("mcpx-svc-");
    cleanups.push(env.restore);
    return resolveServiceContext({ platform, homeDir: env.root, env: {}, uid: 501, username: "A B", windowsUserId: "PC\\A B", runner: fake.runner });
  }

  it("launchd: bootstrap into gui/<uid>, kickstart, bootout", () => {
    const fake = fakeRunner((_c, args) => (args[0] === "print" ? 113 : 0));
    const manager = createLaunchdManager(context("darwin", fake));
    expect(manager.definitionPath).toEndWith(path.join("Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`));
    expect(manager.install(program, { start: true }).ok).toBe(true);
    expect(fs.readFileSync(manager.definitionPath, "utf8")).toContain(`<string>${getServiceLogPath()}</string>`);
    expect(manager.isInstalled()).toBe(true);
    expect(manager.start().ok).toBe(true);
    manager.stop();
    manager.uninstall();
    expect(manager.isInstalled()).toBe(false);
    const target = `gui/501/${LAUNCHD_LABEL}`;
    expect(fake.calls).toEqual([
      `launchctl bootout ${target}`,
      `launchctl enable ${target}`,
      `launchctl bootstrap gui/501 ${manager.definitionPath}`,
      `launchctl print ${target}`,
      `launchctl enable ${target}`,
      `launchctl bootstrap gui/501 ${manager.definitionPath}`,
      `launchctl kickstart ${target}`,
      `launchctl bootout ${target}`,
      `launchctl bootout ${target}`
    ]);
  });

  it("launchd: reports a failed bootstrap with the command and exit code", () => {
    const fake = fakeRunner((_c, args) => (args[0] === "bootstrap" ? 5 : 0));
    const result = createLaunchdManager(context("darwin", fake)).install(program, { start: true });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("launchctl bootstrap gui/501");
    expect(result.message).toContain("exited 5");
  });

  it("systemd: daemon-reload, enable --now, start/stop, disable --now", () => {
    const fake = fakeRunner();
    const manager = createSystemdManager(context("linux", fake));
    expect(manager.definitionPath).toEndWith(path.join(".config", "systemd", "user", "mcpx.service"));
    expect(manager.install(program, { start: true }).ok).toBe(true);
    expect(fs.readFileSync(manager.definitionPath, "utf8")).toContain("ExecStart=\"/usr/bin/node\" \"/opt/mcpx/cli.js\" \"daemon\" \"run\"");
    manager.start();
    manager.stop();
    expect(manager.isLoaded()).toBe(true);
    manager.uninstall();
    expect(manager.isInstalled()).toBe(false);
    expect(fake.calls).toEqual([
      "systemctl --user daemon-reload",
      "systemctl --user enable --now mcpx.service",
      "systemctl --user start mcpx.service",
      "systemctl --user stop mcpx.service",
      "systemctl --user is-active --quiet mcpx.service",
      "systemctl --user disable --now mcpx.service",
      "systemctl --user daemon-reload"
    ]);
  });

  it("schtasks: writes UTF-16 XML + hidden launcher, /Create /XML, /Run, /End, /Delete", () => {
    const fake = fakeRunner();
    const manager = createSchtasksManager(context("win32", fake));
    const task = windowsTaskName("A B");
    expect(task).toBe("mcpx-gateway-A_B");
    expect(manager.install(program, { start: true }).ok).toBe(true);
    const xml = fs.readFileSync(manager.definitionPath);
    expect([...xml.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    const xmlText = xml.subarray(2).toString("utf16le");
    expect(xmlText).toContain("<UserId>PC\\A B</UserId>");
    expect(xmlText).toContain(`&quot;${path.join(getServiceDir(), "mcpx-gateway.vbs")}&quot;`);
    expect(fs.existsSync(path.join(getServiceDir(), "mcpx-gateway.vbs"))).toBe(true);
    manager.stop();
    manager.uninstall();
    expect(manager.isInstalled()).toBe(false);
    expect(fs.existsSync(path.join(getServiceDir(), "mcpx-gateway.vbs"))).toBe(false);
    expect(fake.calls).toEqual([
      `schtasks /Create /TN ${task} /XML ${manager.definitionPath} /F`,
      `schtasks /Run /TN ${task}`,
      `schtasks /End /TN ${task}`,
      `schtasks /End /TN ${task}`,
      `schtasks /Delete /TN ${task} /F`
    ]);
  });

  it("xdg autostart: file only, never claims supervision", () => {
    const fake = fakeRunner();
    const manager = createXdgAutostartManager(context("linux", fake));
    expect(manager.supervised).toBe(false);
    expect(manager.install(program, { start: true }).ok).toBe(true);
    expect(manager.definitionPath).toEndWith(path.join(".config", "autostart", "mcpx-gateway.desktop"));
    expect(fs.readFileSync(manager.definitionPath, "utf8")).toContain("Exec=env MCPX_SUPERVISED=1 /usr/bin/node /opt/mcpx/cli.js daemon run");
    expect(manager.start().ok).toBe(false);
    expect(fake.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

describe("service API with a fake supervisor running a real daemon", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.();
  });

  async function setup(platform: NodeJS.Platform, launchOn: (command: string, args: string[]) => boolean, respond: (command: string, args: string[]) => number = () => 0) {
    const env = setupTempEnv("mcpx-svcapi-");
    const previous = process.env.MCPX_TELEMETRY_DISABLED;
    process.env.MCPX_NO_UPDATE = "1";
    process.env.MCPX_TELEMETRY_DISABLED = "1";
    const config = defaultConfig();
    config.gateway.port = await freePort();
    saveConfig(config);
    const children: ChildProcess[] = [];
    const calls: string[] = [];
    const runner: CommandRunner = (command, args) => {
      calls.push([command, ...args].join(" "));
      if (launchOn(command, args)) {
        children.push(spawn(process.execPath, [CLI_PATH, "daemon", "run"], { env: { ...process.env }, stdio: "ignore" }));
      }
      return { code: respond(command, args), stdout: "", stderr: "" };
    };
    cleanups.push(() => {
      env.restore();
      process.env.MCPX_TELEMETRY_DISABLED = previous;
    });
    cleanups.push(async () => {
      await stopDaemonAsync({ service: false, timeoutMs: 3000 }).catch(() => undefined);
      for (const child of children) child.kill("SIGKILL");
    });
    const context: Partial<ServiceContext> = { platform, homeDir: env.root, env: {}, uid: 501, username: "tester", windowsUserId: "PC\\tester", runner };
    return { config, calls, children, context, root: env.root };
  }

  const platforms: Array<{ platform: NodeJS.Platform; manager: string; launchOn: (command: string, args: string[]) => boolean }> = [
    { platform: "darwin", manager: "launchd", launchOn: (_c, args) => args[0] === "bootstrap" || args[0] === "kickstart" },
    { platform: "linux", manager: "systemd", launchOn: (_c, args) => args.includes("--now") && args.includes("enable") || args[1] === "start" },
    { platform: "win32", manager: "schtasks", launchOn: (_c, args) => args[0] === "/Run" }
  ];

  for (const { platform, manager, launchOn } of platforms) {
    it(`${manager}: install starts the daemon, stop is verified, restart and uninstall work`, async () => {
      const { config, calls, context } = await setup(platform, launchOn);

      const installed = await installService({ cliPath: CLI_PATH, context });
      expect(installed).toMatchObject({ ok: true, action: "install", manager, installed: true, restartOnCrash: true, running: true, port: config.gateway.port });
      expect(installed.definitionPath && fs.existsSync(installed.definitionPath)).toBe(true);

      const status = await getServiceStatus({ context });
      expect(status).toMatchObject({ ok: true, manager, installed: true, running: true, pid: installed.pid });

      const stopped = await stopService({ context });
      expect(stopped).toMatchObject({ ok: true, action: "stop", running: false });
      expect(await waitFor(() => !isPidAlive(installed.pid ?? -1), 3000)).toBe(true);

      const restarted = await restartService({ context });
      expect(restarted).toMatchObject({ ok: true, action: "restart", running: true });
      expect(restarted.instanceId).not.toBe(installed.instanceId);

      const removed = await uninstallService({ context });
      expect(removed).toMatchObject({ ok: true, action: "uninstall", installed: false, running: false });
      expect(await pingDaemon()).toBeNull();
      expect(calls.length).toBeGreaterThan(0);
    }, 60_000);
  }

  it("linux without systemd --user falls back to XDG autostart and says crash restart is unavailable", async () => {
    const { context } = await setup("linux", () => false, (command, args) => (command === "systemctl" && args[1] === "show-environment" ? 1 : 0));
    const result = await installService({ cliPath: CLI_PATH, context });
    expect(result).toMatchObject({ ok: true, manager: "xdg-autostart", restartOnCrash: false, running: false });
    expect(result.warnings.join(" ")).toContain("not restarted if it crashes");
    expect((await startService({ context })).ok).toBe(false);
  }, 30_000);

  it("reports not-installed cleanly", async () => {
    const { context } = await setup("darwin", () => false);
    expect(await getServiceStatus({ context })).toMatchObject({ ok: true, installed: false, manager: null, loaded: null });
    expect(await stopService({ context })).toMatchObject({ ok: false, message: "The mcpx service is not installed." });
    expect(await uninstallService({ context })).toMatchObject({ ok: false });
  }, 30_000);

  it("escalates a daemon that ignores shutdown: supervisor stop, then a forced kill", async () => {
    const { context, calls } = await setup("darwin", () => false);
    const plist = path.join(context.homeDir!, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    fs.writeFileSync(plist, "<plist/>");
    // A stuck "daemon": holds the endpoint, answers ping, ignores shutdown and SIGTERM.
    const stuck = spawn(process.execPath, ["-e", `
      process.on("SIGTERM", () => {});
      const net = require("net");
      require("fs").mkdirSync(require("path").dirname(process.env.ENDPOINT), { recursive: true });
      const server = net.createServer((s) => s.on("data", (d) => {
        if (String(d).includes("ping")) s.end(JSON.stringify({ ok: true, pid: process.pid, ready: true, version: "x", instanceId: "stuck-instance", startedAt: new Date().toISOString(), port: 1 }) + "\\n");
      }));
      server.listen(process.env.ENDPOINT, () => process.stdout.write("ready\\n"));
    `], { env: { ...process.env, ENDPOINT: getControlEndpoint() }, stdio: ["ignore", "pipe", "inherit"] });
    cleanups.push(() => { stuck.kill("SIGKILL"); });
    await new Promise<void>((resolve) => stuck.stdout?.once("data", () => resolve()));

    const result = await stopDaemonAsync({ service: context, timeoutMs: 500 });
    expect(result).toMatchObject({ stopped: true, forced: true, pid: stuck.pid, supervisor: "launchd" });
    expect(calls).toEqual([`launchctl bootout gui/501/${LAUNCHD_LABEL}`]);
    expect(await waitFor(() => stuck.exitCode !== null || stuck.signalCode !== null, 3000)).toBe(true);
  }, 30_000);
});
