import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { currentHost, getClientDefinition, type HostContext } from "../src/adapters/index.js";
import { setDefaultHostOverrides } from "../src/adapters/host.js";
import type { ClientId } from "../src/types.js";

function assignEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

export interface TempEnvContext {
  root: string;
  restore: () => void;
}

export function setupTempEnv(prefix: string): TempEnvContext {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const original = {
    HOME: process.env.HOME,
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    MCPX_SKIP_DAEMON_AUTOSTART: process.env.MCPX_SKIP_DAEMON_AUTOSTART,
    MCPX_CONFIG_HOME: process.env.MCPX_CONFIG_HOME,
    MCPX_DATA_HOME: process.env.MCPX_DATA_HOME,
    MCPX_STATE_HOME: process.env.MCPX_STATE_HOME,
    MCPX_NO_UPDATE: process.env.MCPX_NO_UPDATE,
    MCPX_SECRET_local_gateway_token: process.env.MCPX_SECRET_local_gateway_token,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME
  };

  process.env.HOME = root;
  // Windows harness configs live under APPDATA, which HOME does not redirect.
  process.env.APPDATA = path.join(root, "AppData", "Roaming");
  process.env.LOCALAPPDATA = path.join(root, "AppData", "Local");
  process.env.MCPX_SKIP_DAEMON_AUTOSTART = "1";
  process.env.MCPX_CONFIG_HOME = path.join(root, "config");
  process.env.MCPX_DATA_HOME = path.join(root, "data");
  process.env.MCPX_STATE_HOME = path.join(root, "state");
  process.env.MCPX_SECRET_local_gateway_token = "test-local-token";
  // Client paths honour XDG_CONFIG_HOME; never let tests resolve into the real one.
  delete process.env.XDG_CONFIG_HOME;
  // Install detection must not see this machine's real clients (PATH binaries, /Applications).
  setDefaultHostOverrides(() => isolatedHost(root));

  const restore = () => {
    setDefaultHostOverrides(null);
    assignEnv("HOME", original.HOME);
    assignEnv("APPDATA", original.APPDATA);
    assignEnv("LOCALAPPDATA", original.LOCALAPPDATA);
    process.env.MCPX_SKIP_DAEMON_AUTOSTART = original.MCPX_SKIP_DAEMON_AUTOSTART;
    process.env.MCPX_CONFIG_HOME = original.MCPX_CONFIG_HOME;
    process.env.MCPX_DATA_HOME = original.MCPX_DATA_HOME;
    process.env.MCPX_STATE_HOME = original.MCPX_STATE_HOME;
    process.env.MCPX_NO_UPDATE = original.MCPX_NO_UPDATE;
    process.env.MCPX_SECRET_local_gateway_token = original.MCPX_SECRET_local_gateway_token;
    if (original.XDG_CONFIG_HOME === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = original.XDG_CONFIG_HOME;
    }
    fs.rmSync(root, { recursive: true, force: true });
  };

  return { root, restore };
}

/**
 * Client detection confined to a temp root: no binaries on PATH and no system-wide
 * app bundles, so only what a test creates under `root` counts as installed.
 */
export function isolatedHost(root: string): Partial<HostContext> {
  return {
    env: { ...process.env, PATH: "", Path: "" },
    exists: (filePath) => filePath.startsWith(root) && fs.existsSync(filePath)
  };
}

/** Make clients look installed by creating their primary install marker (e.g. ~/.cursor). */
export function installClients(root: string, ids: ClientId[]): void {
  const ctx = currentHost({ home: root });
  for (const id of ids) {
    const marker = getClientDefinition(id)?.installMarkers(ctx)[0];
    if (marker) {
      fs.mkdirSync(marker, { recursive: true });
    }
  }
}
