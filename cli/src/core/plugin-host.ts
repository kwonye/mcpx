import { spawn } from "node:child_process";
import { loadConfig } from "./config.js";
import { resolvePluginVars } from "./plugin-parse.js";
import { resolvePluginId } from "./plugin-manager.js";
import type { ManagedPlugin } from "../types.js";

const ALLOWLISTED_ENV = new Set(["PATH", "HOME", "TMPDIR", "LANG", "SHELL"]);

function isAncestorOrSelf(ancestor: string, child: string): boolean {
  const rel = child.startsWith(ancestor) ? child.slice(ancestor.length) : null;
  return rel !== null && (rel === "" || rel.startsWith("/"));
}

function getProjectOverride(plugin: ManagedPlugin): { enabled?: boolean; components?: Record<string, boolean> } | null {
  const cwd = process.cwd();
  const overrides = plugin.projectOverrides;
  if (!overrides) return null;
  let best: string | null = null;
  for (const overridePath of Object.keys(overrides)) {
    if (isAncestorOrSelf(overridePath, cwd)) {
      if (!best || overridePath.length > best.length) {
        best = overridePath;
      }
    }
  }
  return best ? overrides[best] : null;
}

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

  const projectOverride = getProjectOverride(plugin);
  if (projectOverride) {
    if (projectOverride.enabled === false) {
      process.stderr.write(`[mcpx] Plugin "${plugin.name}" is disabled for this project\n`);
      process.exit(1);
    }
    if (projectOverride.components?.mcpServers === false) {
      process.stderr.write(`[mcpx] MCP servers for plugin "${plugin.name}" are disabled for this project\n`);
      process.exit(1);
    }
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
  const allPaths = [command, ...args, ...Object.values(resolvedEnv)];
  for (const p of allPaths) {
    if (p.includes("..") || p.startsWith("/")) {
      const resolved = resolvePluginVars(p, pluginRoot, dataDir);
      if (!resolved.startsWith(pluginRoot) && !resolved.startsWith(dataDir)) {
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
    cwd: pluginRoot,
    env: env as Record<string, string>,
  });

  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
}
