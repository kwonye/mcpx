// Pure generators for the per-platform service definitions. No I/O here so
// every platform's output can be unit-tested on any host.
import { DAEMON_EXIT_ALREADY_RUNNING } from "./constants.js";
import {
  escapeXml,
  quoteDesktopExecArg,
  quoteSystemdArg,
  quoteSystemdEnv,
  quoteWindowsArg,
  vbsString
} from "./quote.js";

export interface ServiceProgram {
  /** Absolute path of the runtime (node, bun or the Electron binary). */
  command: string;
  /** Arguments, normally [absolute cli.js, "daemon", "run"]. */
  args: string[];
  /** Extra environment for the daemon process. */
  env: Record<string, string>;
}

function sortedEnv(env: Record<string, string>): Array<[string, string]> {
  for (const name of Object.keys(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`Invalid environment variable name: ${JSON.stringify(name)}`);
    }
  }
  return Object.entries(env).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

export interface LaunchdPlistInput {
  label: string;
  program: ServiceProgram;
  workingDirectory: string;
  /** Captures supervisor-level output (anything before the daemon redirects itself). */
  stdoutPath: string;
  stderrPath: string;
  throttleSeconds?: number;
}

export function renderLaunchdPlist(input: LaunchdPlistInput): string {
  const lines: string[] = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\">",
    "<dict>",
    "  <key>Label</key>",
    `  <string>${escapeXml(input.label)}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...[input.program.command, ...input.program.args].map((arg) => `    <string>${escapeXml(arg)}</string>`),
    "  </array>"
  ];
  const env = sortedEnv(input.program.env);
  if (env.length > 0) {
    lines.push("  <key>EnvironmentVariables</key>", "  <dict>");
    for (const [name, value] of env) {
      lines.push(`    <key>${escapeXml(name)}</key>`, `    <string>${escapeXml(value)}</string>`);
    }
    lines.push("  </dict>");
  }
  lines.push(
    "  <key>WorkingDirectory</key>",
    `  <string>${escapeXml(input.workingDirectory)}</string>`,
    "  <key>RunAtLoad</key>",
    "  <true/>",
    // Restart only on a crash / non-zero exit; a requested shutdown exits 0
    // and stays stopped until the next login or an explicit start.
    "  <key>KeepAlive</key>",
    "  <dict>",
    "    <key>SuccessfulExit</key>",
    "    <false/>",
    "  </dict>",
    "  <key>ThrottleInterval</key>",
    `  <integer>${input.throttleSeconds ?? 10}</integer>`,
    "  <key>ProcessType</key>",
    "  <string>Background</string>",
    "  <key>StandardOutPath</key>",
    `  <string>${escapeXml(input.stdoutPath)}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${escapeXml(input.stderrPath)}</string>`,
    "</dict>",
    "</plist>",
    ""
  );
  return lines.join("\n");
}

export interface SystemdUnitInput {
  description: string;
  program: ServiceProgram;
  workingDirectory: string;
  restartSeconds?: number;
}

export function renderSystemdUnit(input: SystemdUnitInput): string {
  const execStart = [input.program.command, ...input.program.args].map(quoteSystemdArg).join(" ");
  const lines = [
    "[Unit]",
    `Description=${input.description}`,
    "StartLimitIntervalSec=300",
    "StartLimitBurst=10",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${execStart}`,
    `WorkingDirectory=${quoteSystemdArg(input.workingDirectory)}`,
    ...sortedEnv(input.program.env).map(([name, value]) => `Environment=${quoteSystemdEnv(name, value)}`),
    "Restart=on-failure",
    `RestartSec=${input.restartSeconds ?? 5}`,
    `RestartPreventExitStatus=${DAEMON_EXIT_ALREADY_RUNNING}`,
    "TimeoutStopSec=15",
    "",
    "[Install]",
    "WantedBy=default.target",
    ""
  ];
  return lines.join("\n");
}

export interface XdgAutostartInput {
  name: string;
  comment: string;
  program: ServiceProgram;
}

export function renderXdgAutostartEntry(input: XdgAutostartInput): string {
  const envArgs = sortedEnv(input.program.env).map(([name, value]) => `${name}=${value}`);
  const argv = envArgs.length > 0
    ? ["env", ...envArgs, input.program.command, ...input.program.args]
    : [input.program.command, ...input.program.args];
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${input.name}`,
    `Comment=${input.comment}`,
    `Exec=${argv.map(quoteDesktopExecArg).join(" ")}`,
    "Terminal=false",
    "NoDisplay=true",
    "X-GNOME-Autostart-enabled=true",
    ""
  ].join("\n");
}

export interface WindowsLauncherInput {
  program: ServiceProgram;
  /** Exit codes that end the relaunch loop (a requested shutdown, or another instance). */
  stopExitCodes?: number[];
}

/**
 * VBScript shim run by wscript.exe. It starts the daemon with a hidden window
 * (node.exe is a console program; launched directly from Task Scheduler it
 * would open a console window) and relaunches it with backoff when it exits
 * with a failure code, because Task Scheduler's own RestartOnFailure does not
 * fire on a non-zero exit code.
 */
export function renderWindowsLauncher(input: WindowsLauncherInput): string {
  const commandLine = [input.program.command, ...input.program.args].map(quoteWindowsArg).join(" ");
  const stopCodes = input.stopExitCodes ?? [0, DAEMON_EXIT_ALREADY_RUNNING];
  const lines = [
    "' Generated by mcpx. Launches the mcpx gateway daemon hidden and relaunches it on failure.",
    "Option Explicit",
    "Dim shell, procEnv, commandLine, exitCode, delay, started",
    "Set shell = CreateObject(\"WScript.Shell\")",
    "Set procEnv = shell.Environment(\"PROCESS\")",
    ...sortedEnv(input.program.env).map(([name, value]) => `procEnv(${vbsString(name)}) = ${vbsString(value)}`),
    `commandLine = ${vbsString(commandLine)}`,
    "delay = 5",
    "Do",
    "  started = Now",
    "  exitCode = shell.Run(commandLine, 0, True)",
    `  If ${stopCodes.map((code) => `exitCode = ${code}`).join(" Or ")} Then Exit Do`,
    "  If DateDiff(\"s\", started, Now) > 60 Then delay = 5",
    "  WScript.Sleep delay * 1000",
    "  delay = delay * 2",
    "  If delay > 60 Then delay = 60",
    "Loop",
    "WScript.Quit exitCode",
    ""
  ];
  return lines.join("\r\n");
}

export interface WindowsTaskInput {
  description: string;
  /** DOMAIN\user the logon trigger and principal are bound to. */
  userId: string;
  wscriptPath: string;
  launcherPath: string;
  workingDirectory: string;
}

/** Task Scheduler 1.2 XML. Write it as UTF-16LE with a BOM for schtasks /XML. */
export function renderWindowsTaskXml(input: WindowsTaskInput): string {
  const user = escapeXml(input.userId);
  const args = `//B //Nologo ${quoteWindowsArg(input.launcherPath)}`;
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-16\"?>",
    "<Task version=\"1.2\" xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\">",
    "  <RegistrationInfo>",
    `    <Description>${escapeXml(input.description)}</Description>`,
    "  </RegistrationInfo>",
    "  <Triggers>",
    "    <LogonTrigger>",
    "      <Enabled>true</Enabled>",
    `      <UserId>${user}</UserId>`,
    "    </LogonTrigger>",
    "  </Triggers>",
    "  <Principals>",
    "    <Principal id=\"Author\">",
    `      <UserId>${user}</UserId>`,
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
    `      <Command>${escapeXml(input.wscriptPath)}</Command>`,
    `      <Arguments>${escapeXml(args)}</Arguments>`,
    `      <WorkingDirectory>${escapeXml(input.workingDirectory)}</WorkingDirectory>`,
    "    </Exec>",
    "  </Actions>",
    "</Task>",
    ""
  ].join("\r\n");
}

/** UTF-16LE with BOM, the encoding schtasks /XML and wscript reliably accept for non-ASCII paths. */
export function encodeUtf16LeWithBom(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
}
