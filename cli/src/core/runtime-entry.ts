import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function localCliCommand(args: string[]): { command: string; args: string[]; env?: Record<string, string> } {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [process.env.MCPX_CLI_ENTRY, path.join(here, "..", "cli.js"), path.join(here, "cli.js"), path.join(here, "..", "cli.ts")].filter((p): p is string => Boolean(p));
  const entry = candidates.find(p => fs.existsSync(p));
  if (!entry) throw new Error("Cannot locate the installed mcpx CLI runtime. Reinstall mcpx.");
  const env: Record<string, string> = process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {};
  for (const key of ["MCPX_CONFIG_HOME", "MCPX_DATA_HOME", "MCPX_STATE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"]) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  return { command: process.execPath, args: [entry, ...args], ...(Object.keys(env).length ? { env } : {}) };
}
