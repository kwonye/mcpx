import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../src/core/config.js";
import { resolveGatewayPort } from "../src/core/daemon.js";
import { setupTempEnv } from "./helpers.js";

async function startTcpServer(): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to bind server."));
        return;
      }

      resolve({ server, port: address.port });
    });
  });
}

async function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

describe("daemon utilities", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) {
        await fn();
      }
    }
  });

  it("chooses deterministic fallback port when configured port is busy", async () => {
    const env = setupTempEnv("mcpx-daemon-");
    cleanups.push(env.restore);

    const occupied = await startTcpServer();
    cleanups.push(() => closeServer(occupied.server));

    const config = defaultConfig();
    config.gateway.port = occupied.port;

    const resolved = await resolveGatewayPort(config);

    expect(resolved).toBeGreaterThan(occupied.port);
    expect(config.gateway.port).toBe(resolved);
  });
});
