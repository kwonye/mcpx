import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function localCliCommand(args: string[]): { command: string; args: string[]; env?: Record<string, string> } {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [process.env.MCPX_CLI_ENTRY, path.join(here, "..", "cli.js"), path.join(here, "cli.js"), path.join(here, "..", "cli.ts")].filter((p): p is string => Boolean(p));
  const entry = candidates.find(p => fs.existsSync(p));
  if (!entry) throw new Error("Cannot locate the installed mcpx CLI runtime. Reinstall mcpx.");
  return { command: process.execPath, args: [entry, ...args], ...(process.versions.electron ? { env: { ELECTRON_RUN_AS_NODE: "1" } } : {}) };
}
