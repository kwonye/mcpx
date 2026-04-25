import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { loadConfig } from "../src/core/config.js";
import { getConfigPath } from "../src/core/paths.js";
import { setupTempEnv } from "./helpers.js";

describe("config loading", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      fn?.();
    }
  });

  it("defaults legacy servers to enabled when the field is absent", () => {
    const env = setupTempEnv("mcpx-config-");
    cleanups.push(env.restore);

    const configPath = getConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      schemaVersion: 1,
      gateway: {
        port: 37373,
        tokenRef: "secret://local_gateway_token",
        autoStart: true
      },
      servers: {
        vercel: {
          transport: "http",
          url: "https://mcp.vercel.com"
        }
      },
      clients: {}
    }, null, 2));

    const config = loadConfig();

    expect(config.servers.vercel).toMatchObject({
      transport: "http",
      url: "https://mcp.vercel.com",
      enabled: true
    });
  });
});
