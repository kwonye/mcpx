import fs from "node:fs";
import path from "node:path";
import { buildEnrichedPath } from "../core/spawn-env.js";
import { DAEMON_LOG_FILE_ENV, SUPERVISED_ENV } from "./constants.js";
import type { ServiceProgram } from "./definitions.js";

export interface ResolveServiceProgramOptions {
  /** Absolute path to the bundled cli.js (the app passes its resources copy). */
  cliPath: string;
  /** Runtime that executes cli.js. Defaults to process.execPath. */
  execPath?: string;
  /** Whether execPath is an Electron binary. Defaults to detecting the current runtime. */
  electron?: boolean;
  platform?: NodeJS.Platform;
  /** Environment to copy home overrides and PATH from. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Log file the supervised daemon writes its own output to. */
  logFile: string;
  exists?: (candidate: string) => boolean;
}

const PASSTHROUGH_ENV = [
  "MCPX_CONFIG_HOME",
  "MCPX_DATA_HOME",
  "MCPX_STATE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME"
] as const;

/**
 * The exact program an OS supervisor should launch: [runtime, cli.js, "daemon", "run"]
 * in supervised mode. With an Electron runtime, ELECTRON_RUN_AS_NODE=1 makes the
 * app binary behave as Node (and MCPX_DAEMON_CHILD=1 covers builds where the
 * RunAsNode fuse is off, via the app's daemon-child entry).
 */
export function resolveServiceProgram(options: ResolveServiceProgramOptions): ServiceProgram {
  const platform = options.platform ?? process.platform;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const exists = options.exists ?? fs.existsSync;
  const execPath = options.execPath ?? process.execPath;
  const electron = options.electron ?? typeof process.versions.electron === "string";
  const sourceEnv = options.env ?? process.env;

  for (const [label, candidate] of [["runtime", execPath], ["cli", options.cliPath]] as const) {
    if (!candidate || !pathApi.isAbsolute(candidate)) {
      throw new Error(`The ${label} path for the mcpx service must be absolute: ${JSON.stringify(candidate)}`);
    }
    if (!exists(candidate)) {
      throw new Error(`The ${label} path for the mcpx service does not exist: ${candidate}`);
    }
  }

  const env: Record<string, string> = {
    [SUPERVISED_ENV]: "1",
    [DAEMON_LOG_FILE_ENV]: options.logFile,
    MCPX_DAEMON_CHILD: "1"
  };
  if (electron) env.ELECTRON_RUN_AS_NODE = "1";
  for (const name of PASSTHROUGH_ENV) {
    const value = sourceEnv[name];
    if (value && value.trim()) env[name] = value;
  }
  // launchd and systemd start user services with a minimal PATH; stdio
  // upstreams (npx, uvx, ...) need the user's. Windows tasks inherit it.
  if (platform !== "win32") env.PATH = buildEnrichedPath(sourceEnv.PATH ?? "");

  return { command: execPath, args: [options.cliPath, "daemon", "run"], env };
}
