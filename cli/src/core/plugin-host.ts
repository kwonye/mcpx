import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { loadConfig } from "./config.js";
import { resolvePluginVars } from "./plugin-parse.js";
import { resolvePluginId } from "./plugin-manager.js";

const POSIX_INHERITED_ENV = ["PATH", "HOME", "TMPDIR", "LANG", "SHELL"] as const;
// Windows cannot resolve `node` to `node.exe`, or load system DLLs, unless these
// are present. The MCP client only forwards a subset, and it omits PATHEXT.
const WINDOWS_INHERITED_ENV = [
  "PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC",
  "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
  "LANG", "SHELL"
] as const;
const DEFAULT_WINDOWS_PATHEXT = ".COM;.EXE;.BAT;.CMD;.VBS;.JS;.WS;.MSC";

export function pluginHostBaseEnv(
  source: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of platform === "win32" ? WINDOWS_INHERITED_ENV : POSIX_INHERITED_ENV) {
    const value = source[key];
    if (value) env[key] = value;
  }
  if (platform === "win32" && !env.PATHEXT) env.PATHEXT = DEFAULT_WINDOWS_PATHEXT;
  return env;
}

// libuv resolves `node` → `node.exe` with the parent process PATHEXT, not the
// env block passed to the child. The MCP client does not forward PATHEXT.
export function ensureWindowsExecutablePath(parentEnv: NodeJS.ProcessEnv, platform: NodeJS.Platform): void {
  if (platform === "win32" && !parentEnv.PATHEXT) parentEnv.PATHEXT = DEFAULT_WINDOWS_PATHEXT;
}

// Spawn needs an absolute executable on Windows. The host process is started
// with a trimmed environment, so PATHEXT is often missing and `node` does not
// resolve to `node.exe`.
export function resolveSpawnCommand(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  exists: (candidate: string) => boolean = fs.existsSync
): string {
  if (platform !== "win32" || path.win32.isAbsolute(command) || path.win32.extname(command)) return command;
  const dirs = (env.PATH ?? env.Path ?? "").split(";").filter(Boolean);
  const exts = (env.PATHEXT || DEFAULT_WINDOWS_PATHEXT).split(";").filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const suffix = ext.startsWith(".") ? ext : `.${ext}`;
      const candidate = path.win32.join(dir, command + suffix);
      if (exists(candidate)) return candidate;
    }
  }
  return command;
}

interface PluginProcess {
  exited: Promise<number>;
  kill(signal: NodeJS.Signals): void;
}

function childEnv(env: Record<string, string | undefined>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) resolved[key] = value;
  }
  return resolved;
}

function failStart(message: string): Promise<number> {
  return new Promise((resolve) => {
    process.stderr.write(`[mcpx] Failed to start plugin server: ${message}\n`, () => resolve(1));
  });
}

function failHost(message: string): never {
  const line = message.endsWith("\n") ? message : `${message}\n`;
  try { fs.writeSync(2, line); } catch { /* stderr may already be closed */ }
  const diag = process.env.MCPX_HOST_DIAG;
  if (diag) {
    try { fs.appendFileSync(diag, line); } catch { /* diagnostic only */ }
  }
  process.exit(1);
}

function noteHostDiagnostic(message: string): void {
  const line = message.endsWith("\n") ? message : `${message}\n`;
  try { fs.writeSync(2, line); } catch { /* stderr may already be closed */ }
  const diag = process.env.MCPX_HOST_DIAG;
  if (!diag) return;
  try { fs.appendFileSync(diag, line); } catch { /* diagnostic only */ }
}

function trackChild(child: ReturnType<typeof spawn>): PluginProcess {
  let settled = false;
  const exited = new Promise<number>((resolve) => {
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      resolve(code);
    };
    child.on("error", (error) => {
      noteHostDiagnostic(`[mcpx] Failed to start plugin server: ${error.message}`);
      finish(1);
    });
    // `exit` can run before stderr is flushed. `close` means the pipes are done.
    child.on("close", (code) => finish(code ?? 1));
  });
  return { exited, kill: (signal) => child.kill(signal) };
}

// Windows rejects inheriting the MCP pipes (`EINVAL`) and a piped stdin can
// already be at EOF, which makes the plugin exit before server/discover.
// Copy bytes without forwarding that EOF, and keep stderr for the error.
function launchWindowsNode(resolved: string, args: string[], cwd: string, env: Record<string, string>): PluginProcess {
  const child = spawn(resolved, args, { stdio: ["pipe", "pipe", "pipe"], cwd, env, windowsHide: true });
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
  for (const stream of [child.stdin, child.stdout, child.stderr, process.stdin, process.stdout]) {
    stream?.on("error", () => undefined);
  }
  process.stdin.on("data", (chunk) => { child.stdin?.write(chunk); });
  if (child.stdout) child.stdout.pipe(process.stdout, { end: false });
  process.stdin.resume();
  const tracked = trackChild(child);
  return {
    kill: tracked.kill,
    exited: tracked.exited.then((code) => {
      if (process.env.MCPX_HOST_DIAG) {
        const launched = `command=${resolved} cwd=${cwd} cwdExists=${fs.existsSync(cwd)} args=${args.join(" ")}`;
        noteHostDiagnostic(`plugin exit ${code}; ${launched}; stderr=${stderr.trim() || "<empty>"}`);
      }
      return code;
    })
  };
}

function launchPlugin(command: string, args: string[], cwd: string, env: Record<string, string>): PluginProcess {
  const resolved = resolveSpawnCommand(command, env, process.platform);
  if (process.platform === "win32" && !process.versions.bun) return launchWindowsNode(resolved, args, cwd, env);

  const bunSpawn = (globalThis as { Bun?: { spawn?: (options: {
    cmd: string[];
    cwd: string;
    env: Record<string, string>;
    stdin: "inherit";
    stdout: "inherit";
    stderr: "inherit";
  }) => { exited: Promise<number>; kill: (signal?: NodeJS.Signals) => void } } }).Bun?.spawn;

  // Bun's node:child_process stdio sharing does not duplicate piped handles on
  // Windows. Bun.spawn inherit duplicates the host's actual stdin/stdout handles.
  if (bunSpawn) {
    try {
      const proc = bunSpawn({ cmd: [resolved, ...args], cwd, env, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
      return { exited: proc.exited.then((code) => code ?? 1), kill: (signal) => proc.kill(signal) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { exited: failStart(message), kill: () => undefined };
    }
  }

  return trackChild(spawn(resolved, args, { stdio: [0, 1, 2], cwd, env }));
}

export async function runPluginHost(pluginNameOrId: string, serverId: string): Promise<void> {
  const config = loadConfig();
  const id = resolvePluginId(config, pluginNameOrId);
  const plugin = config.plugins?.[id];
  if (!plugin) {
    failHost(`[mcpx] Plugin "${pluginNameOrId}" not found`);
  }

  if (!plugin.enabled) {
    failHost(`[mcpx] Plugin "${plugin.name}" is disabled`);
  }

  if (plugin.approvals?.mcpServers === false) {
    failHost(`[mcpx] MCP servers for plugin "${plugin.name}" are not approved`);
  }

  const serverDef = plugin.discovered.mcpServers.find((s) => s.id === serverId);
  if (!serverDef) {
    failHost(`[mcpx] Server "${serverId}" not found in plugin "${plugin.name}"`);
  }

  const pluginRoot = plugin.root;
  const dataDir = plugin.dataDir;

  const command = resolvePluginVars(serverDef.command, pluginRoot, dataDir);
  const args = (serverDef.args ?? []).map((a) => resolvePluginVars(a, pluginRoot, dataDir));
  const serverEnv = serverDef.env ?? {};
  const resolvedEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(serverEnv)) {
    resolvedEnv[k] = resolvePluginVars(v, pluginRoot, dataDir);
  }

  // Path traversal guard
  const cwd = serverDef.cwd ? resolvePluginVars(serverDef.cwd, pluginRoot, dataDir) : pluginRoot;
  const allPaths = [command, cwd, ...args, ...Object.values(resolvedEnv)];
  const resolvedPluginRoot = path.resolve(pluginRoot);
  const resolvedDataDir = path.resolve(dataDir);
  for (const p of allPaths) {
    if (p.includes("..") || p.startsWith("/")) {
      const resolved = path.isAbsolute(p)
        ? path.resolve(p)
        : path.resolve(pluginRoot, p);
      const withinRoot = resolved === resolvedPluginRoot || resolved.startsWith(resolvedPluginRoot + path.sep);
      const withinData = resolved === resolvedDataDir || resolved.startsWith(resolvedDataDir + path.sep);
      if (!withinRoot && !withinData) {
        failHost(`[mcpx] Rejected path escapes plugin root: ${p}`);
      }
    }
  }

  // Build env: allowlisted vars + server-declared env + mcpx vars
  const base = pluginHostBaseEnv();
  ensureWindowsExecutablePath(base, process.platform);
  const env: Record<string, string | undefined> = { ...base };
  for (const [k, v] of Object.entries(resolvedEnv)) {
    env[k] = v;
  }
  // Expand LC_* variables from current env
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("LC_") && v) {
      env[k] = v;
    }
  }
  const venvBin = path.join(dataDir, "venv", process.platform === "win32" ? "Scripts" : "bin");
  if (fs.existsSync(venvBin)) { env.PATH = `${venvBin}${path.delimiter}${env.PATH ?? ""}`; env.VIRTUAL_ENV = path.dirname(venvBin); }
  env.MCPX_PLUGIN_ROOT = pluginRoot;
  env.MCPX_PLUGIN_DATA = dataDir;
  env.CLAUDE_PLUGIN_ROOT = pluginRoot;
  env.CLAUDE_PLUGIN_DATA = dataDir;

  ensureWindowsExecutablePath(process.env, process.platform);
  const child = launchPlugin(command, args, cwd, childEnv(env));
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  // Stay alive until the plugin exits. Returning earlier lets Bun treat the
  // CLI command as finished and close the MCP pipes mid-discover.
  process.exit(await child.exited);
}
