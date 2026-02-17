import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface TempEnvContext {
  root: string;
  restore: () => void;
}

export function setupTempEnv(prefix: string): TempEnvContext {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const original = {
    HOME: process.env.HOME,
    MCPX_CONFIG_HOME: process.env.MCPX_CONFIG_HOME,
    MCPX_DATA_HOME: process.env.MCPX_DATA_HOME,
    MCPX_STATE_HOME: process.env.MCPX_STATE_HOME,
    MCPX_SECRET_local_gateway_token: process.env.MCPX_SECRET_local_gateway_token
  };

  process.env.HOME = root;
  process.env.MCPX_CONFIG_HOME = path.join(root, "config");
  process.env.MCPX_DATA_HOME = path.join(root, "data");
  process.env.MCPX_STATE_HOME = path.join(root, "state");
  process.env.MCPX_SECRET_local_gateway_token = "test-local-token";

  const restore = () => {
    process.env.HOME = original.HOME;
    process.env.MCPX_CONFIG_HOME = original.MCPX_CONFIG_HOME;
    process.env.MCPX_DATA_HOME = original.MCPX_DATA_HOME;
    process.env.MCPX_STATE_HOME = original.MCPX_STATE_HOME;
    process.env.MCPX_SECRET_local_gateway_token = original.MCPX_SECRET_local_gateway_token;
    fs.rmSync(root, { recursive: true, force: true });
  };

  return { root, restore };
}
