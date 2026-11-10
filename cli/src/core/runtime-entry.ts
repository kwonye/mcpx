import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolveLocalCliLaunch(input: {
  here: string;
  entry: string;
  execPath: string;
  platform: NodeJS.Platform;
  bun: boolean;
  electron: boolean;
  distCliExists: boolean;
}): { command: string; script: string } {
  // Bun on Windows does not hand piped MCP stdin/stdout to a grandchild.
  // The built CLI runs under node, which can relay those pipes.
  if (!input.electron && input.bun && input.platform === "win32" && input.entry.endsWith(".ts") && input.distCliExists) {
    return { command: "node", script: path.win32.join(input.here, "..", "..", "dist", "cli.js") };
  }
  return { command: input.execPath, script: input.entry };
}

export function localCliCommand(args: string[]): { command: string; args: string[]; env?: Record<string, string> } {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [process.env.MCPX_CLI_ENTRY, path.join(here, "..", "cli.js"), path.join(here, "cli.js"), path.join(here, "..", "cli.ts")].filter((p): p is string => Boolean(p));
  const entry = candidates.find(p => fs.existsSync(p));
  if (!entry) throw new Error("Cannot locate the installed mcpx CLI runtime. Reinstall mcpx.");
  const env: Record<string, string> = process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {};
  for (const key of ["MCPX_CONFIG_HOME", "MCPX_DATA_HOME", "MCPX_STATE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"]) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  const launch = resolveLocalCliLaunch({
    here,
    entry,
    execPath: process.execPath,
    platform: process.platform,
    bun: Boolean(process.versions.bun),
    electron: Boolean(process.versions.electron),
    distCliExists: fs.existsSync(path.join(here, "..", "..", "dist", "cli.js"))
  });
  return { command: launch.command, args: [launch.script, ...args], ...(Object.keys(env).length ? { env } : {}) };
}
