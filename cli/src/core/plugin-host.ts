import path from "node:path";
import { spawn } from "node:child_process";
import { loadConfig } from "./config.js";
import { resolvePluginVars } from "./plugin-parse.js";
import { resolvePluginId } from "./plugin-manager.js";

const ALLOWLISTED_ENV = new Set(["PATH", "HOME", "TMPDIR", "LANG", "SHELL"]);

export function runPluginHost(pluginNameOrId: string, serverId: string): void {
  const config = loadConfig();
  const id = resolvePluginId(config, pluginNameOrId);
  const plugin = config.plugins?.[id];
  if (!plugin) {
    process.stderr.write(`[mcpx] Plugin "${pluginNameOrId}" not found\n`);
    process.exit(1);
  }

  if (!plugin.enabled) {
    process.stderr.write(`[mcpx] Plugin "${plugin.name}" is disabled\n`);
    process.exit(1);
  }

  if (plugin.approvals?.mcpServers === false) {
    process.stderr.write(`[mcpx] MCP servers for plugin "${plugin.name}" are not approved\n`);
    process.exit(1);
  }

  const serverDef = plugin.discovered.mcpServers.find((s) => s.id === serverId);
  if (!serverDef) {
    process.stderr.write(`[mcpx] Server "${serverId}" not found in plugin "${plugin.name}"\n`);
    process.exit(1);
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
        process.stderr.write(`[mcpx] Rejected path escapes plugin root: ${p}\n`);
        process.exit(1);
      }
    }
  }

  // Build env: allowlisted vars + server-declared env + mcpx vars
  const env: Record<string, string | undefined> = {};
  for (const key of ALLOWLISTED_ENV) {
    const val = process.env[key];
    if (val) env[key] = val;
  }
  for (const [k, v] of Object.entries(resolvedEnv)) {
    env[k] = v;
  }
  // Expand LC_* variables from current env
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("LC_") && v) {
      env[k] = v;
    }
  }
  env.MCPX_PLUGIN_ROOT = pluginRoot;
  env.MCPX_PLUGIN_DATA = dataDir;
  env.CLAUDE_PLUGIN_ROOT = pluginRoot;
  env.CLAUDE_PLUGIN_DATA = dataDir;

  const child = spawn(command, args, {
    stdio: "inherit",
    cwd,
    env: env as Record<string, string>,
  });

  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
  child.on("error", (error) => {
    process.stderr.write(`[mcpx] Failed to start plugin server: ${error.message}\n`);
    process.exit(1);
  });
}
