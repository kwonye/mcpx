import http from "node:http";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "bun:test";
import { createGatewayServer } from "../src/gateway/server.js";
import { defaultConfig, saveConfig } from "../src/core/config.js";
import { SecretsManager } from "../src/core/secrets.js";
import { setupTempEnv } from "./helpers.js";

// `mcpx proxy <name>` (runStdioProxy in src/core/proxy.ts) installs SIGTERM/SIGINT
// handlers and calls process.exit(), so it must never run in-process inside the
// test runner. Every test here spawns the real built CLI as a child process and
// drives it over its actual stdio transport instead.
const CLI_PATH = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const LOCAL_TOKEN = "test-local-token";

interface StartedServer {
  server: http.Server;
  port: number;
}

async function startServer(handler: http.RequestListener): Promise<StartedServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // The MCP SDK's StreamableHTTPClientTransport probes for an SSE stream with a
      // GET request (Accept: text/event-stream) when the gateway connects to this
      // fake upstream. Reply 405 so it gives up gracefully (per spec, 405 means SSE
      // is not supported at this endpoint) instead of hanging or erroring.
      if (req.method === "GET" && req.headers.accept?.includes("text/event-stream")) {
        res.statusCode = 405;
        res.end();
        return;
      }
      handler(req, res);
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to resolve bound port."));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

async function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function waitForListening(server: http.Server): Promise<void> {
  if (server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
}

function respondWithInit(res: http.ServerResponse, id: string | number | null): void {
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        serverInfo: { name: "test-upstream", version: "1.0.0" }
      }
    })
  );
}

/**
 * Stands up a fake upstream (one "echo" tool) behind a real gateway, points a saved
 * config at both, and returns the env + upstream server name a spawned
 * `mcpx proxy <name>` child needs to reach that gateway.
 */
async function setupProxyFixture(
  prefix: string,
  cleanups: Array<() => Promise<void> | void>
): Promise<{ env: NodeJS.ProcessEnv; serverName: string }> {
  const tempEnv = setupTempEnv(prefix);
  cleanups.push(tempEnv.restore);

  const upstream = await startServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { method: string; id: string | number | null };

    if (payload.method === "initialize") {
      respondWithInit(res, payload.id);
      return;
    }
    if (payload.method === "tools/list") {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: payload.id,
          result: { tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }] }
        })
      );
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: {} }));
  });
  cleanups.push(() => closeServer(upstream.server));

  const serverName = "proxied_upstream";
  const config = defaultConfig();
  config.servers[serverName] = {
    transport: "http",
    url: `http://127.0.0.1:${upstream.port}/mcp`
  };

  const gateway = createGatewayServer({
    port: 0,
    expectedToken: LOCAL_TOKEN,
    secrets: new SecretsManager()
  });
  await waitForListening(gateway);
  cleanups.push(() => closeServer(gateway));

  const gatewayAddress = gateway.address();
  if (!gatewayAddress || typeof gatewayAddress === "string") {
    throw new Error("Failed to resolve gateway address.");
  }

  // runStdioProxy() derives the gateway URL solely from config.gateway.port, so the
  // saved config's port must match wherever the gateway actually ended up bound
  // (createGatewayServer uses an ephemeral port, like the rest of this suite).
  config.gateway.port = gatewayAddress.port;
  saveConfig(config);

  return {
    env: {
      // setupTempEnv() already pointed HOME/MCPX_*_HOME at an isolated temp dir and
      // set MCPX_SECRET_local_gateway_token to LOCAL_TOKEN on process.env; spreading
      // it forwards those plus everything the child needs to resolve "node" (PATH).
      ...process.env,
      // The proxy auto-starts the background daemon when none is detected running;
      // that daemon would try to bind config.gateway.port itself and collide with
      // the fixture gateway above, so tell it to skip that entirely.
      MCPX_SKIP_DAEMON_AUTOSTART: "1"
    },
    serverName
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  ]);
}

interface ProxyClient {
  proc: ReturnType<typeof Bun.spawn>;
  writeMessage: (message: unknown) => void;
  readMessage: (timeoutMs?: number) => Promise<any>;
}

// The stdio transport (see @modelcontextprotocol/sdk shared/stdio.js, used by both
// runStdioProxy's StdioServerTransport and this harness) frames messages as one JSON
// document per newline-terminated line -- no Content-Length headers.
function spawnProxy(serverName: string, env: NodeJS.ProcessEnv): ProxyClient {
  const proc = Bun.spawn(["node", CLI_PATH, "proxy", serverName], {
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe"
  });

  let stderrText = "";
  (async () => {
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        stderrText += decoder.decode(value, { stream: true });
      }
    } catch {
      // Reader torn down by process teardown; nothing left worth capturing.
    }
  })();

  const stdoutReader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  async function readMessage(timeoutMs = 10_000): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        return JSON.parse(line);
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`Timed out waiting for proxy stdout message. buffered=${JSON.stringify(buffer)} stderr=${JSON.stringify(stderrText)}`);
      }

      const { value, done } = await withTimeout(
        stdoutReader.read(),
        remaining,
        `Timed out waiting for proxy stdout chunk. buffered=${JSON.stringify(buffer)} stderr=${JSON.stringify(stderrText)}`
      );
      if (done) {
        throw new Error(`Proxy stdout closed unexpectedly. buffered=${JSON.stringify(buffer)} stderr=${JSON.stringify(stderrText)}`);
      }
      buffer += decoder.decode(value, { stream: true });
    }
  }

  function writeMessage(message: unknown): void {
    proc.stdin.write(`${JSON.stringify(message)}\n`);
    proc.stdin.flush();
  }

  return { proc, writeMessage, readMessage };
}

async function killProxy(proc: ReturnType<typeof Bun.spawn>): Promise<void> {
  if (proc.exitCode !== null) {
    return;
  }

  proc.kill("SIGTERM");
  try {
    await withTimeout(proc.exited, 3_000, "SIGTERM timeout");
  } catch {
    if (proc.exitCode === null) {
      proc.kill("SIGKILL");
      await proc.exited;
    }
  }
}

describe("stdio proxy (mcpx proxy <name>)", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) {
        await fn();
      }
    }
  });

  it("completes an MCP initialize handshake over stdio through the real gateway", async () => {
    const { env, serverName } = await setupProxyFixture("mcpx-proxy-init-", cleanups);
    const proxy = spawnProxy(serverName, env);
    cleanups.push(() => killProxy(proxy.proc));

    proxy.writeMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "proxy-test-client", version: "1.0.0" }
      }
    });

    const response = await proxy.readMessage();
    expect(response.id).toBe(1);
    expect(response.error).toBeUndefined();
    expect(response.result.protocolVersion).toBe("2024-11-05");
    expect(response.result.serverInfo.name).toBe("mcpx");
  }, 15_000);

  it("bridges tools/list over stdio and returns the upstream's tools", async () => {
    const { env, serverName } = await setupProxyFixture("mcpx-proxy-tools-", cleanups);
    const proxy = spawnProxy(serverName, env);
    cleanups.push(() => killProxy(proxy.proc));

    proxy.writeMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "proxy-test-client", version: "1.0.0" }
      }
    });
    await proxy.readMessage();

    proxy.writeMessage({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const response = await proxy.readMessage();

    expect(response.id).toBe(2);
    expect(response.error).toBeUndefined();
    expect(response.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["echo"]);
  }, 15_000);

  it("exits cleanly when the client closes stdin", async () => {
    const { env, serverName } = await setupProxyFixture("mcpx-proxy-close-", cleanups);
    const proxy = spawnProxy(serverName, env);
    cleanups.push(() => killProxy(proxy.proc));

    await proxy.proc.stdin.end();

    const exitCode = await withTimeout(proxy.proc.exited, 10_000, "Timed out waiting for proxy to exit after stdin closed.");
    expect(exitCode).toBe(0);
  }, 15_000);
});
