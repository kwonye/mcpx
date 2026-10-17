import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "bun:test";
import { createGatewayServer } from "../src/gateway/server.js";
import { defaultConfig, saveConfig } from "../src/core/config.js";
import { SecretsManager } from "../src/core/secrets.js";
import { setupTempEnv } from "./helpers.js";

interface StartedServer {
  server: http.Server;
  port: number;
}

class MemorySecrets extends SecretsManager {
  readonly values = new Map<string, string>();

  setSecret(name: string, value: string): void {
    this.values.set(name, value);
  }

  getSecret(name: string): string | null {
    return this.values.get(name) ?? null;
  }

  removeSecret(name: string): void {
    this.values.delete(name);
  }
}

async function startServer(handler: http.RequestListener): Promise<StartedServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // The MCP SDK sends a GET request (Accept: text/event-stream) to probe for
      // an SSE stream. Return 405 so it gives up gracefully (per spec, 405 means
      // SSE not supported). Don't intercept other GET requests (e.g. .well-known/).
      if (req.method === "GET" && req.headers.accept?.includes("text/event-stream")) {
        res.statusCode = 405;
        res.end();
        return;
      }
      const end = res.end.bind(res);
      res.end = ((chunk?: unknown, ...args: unknown[]) => {
        if (typeof chunk === "string") {
          try {
            const payload = JSON.parse(chunk) as { result?: Record<string, unknown> };
            if (payload.result && typeof payload.result === "object" && !payload.result.resultType) {
              payload.result = { resultType: "complete", ttlMs: 0, cacheScope: "private", ...payload.result };
              chunk = JSON.stringify(payload);
            }
          } catch {
            // Non-JSON fixture responses should pass through unchanged.
          }
        }
        return end(chunk as never, ...args as never[]);
      }) as typeof res.end;
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

function respondWithDiscover(res: http.ServerResponse, id: string | number | null): void {
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      result: {
        supportedVersions: ["2026-07-28"],
        capabilities: { tools: {}, resources: {}, prompts: {} },
        resultType: "complete"
      }
    })
  );
}

function modernRpcBody(method: string, id: string | number, params: Record<string, unknown> = {}): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "mcpx-test", version: "2.0.0" },
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  });
}

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const body = typeof init.body === "string" ? init.body : undefined;
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
  if (body && url.pathname === "/mcp") {
    try {
      const parsed = JSON.parse(body) as { method?: string; params?: { name?: string; uri?: string; _meta?: Record<string, unknown> } };
      if (parsed.params?._meta?.["io.modelcontextprotocol/protocolVersion"]) {
        const headers = new Headers(init.headers);
        headers.set("mcp-method", parsed.method ?? "");
        const name = parsed.params.name ?? parsed.params.uri;
        if (typeof name === "string") headers.set("mcp-name", name);
        return nativeFetch(input, { ...init, headers });
      }
    } catch {
      // Let fetch and the server report malformed test requests normally.
    }
  }
  return nativeFetch(input, init);
};

describe("gateway passthrough", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) {
        await fn();
      }
    }
  });

  it("adds and removes upstream visibility immediately from central config", async () => {
    const env = setupTempEnv("mcpx-gateway-");
    cleanups.push(env.restore);

    const upstream = await startServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }

      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { method: string; id: string | number | null };
      if (payload.method === "server/discover") {
        respondWithDiscover(res, payload.id);
        return;
      }

      if (payload.method === "tools/list") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }] } }));
        return;
      }

      if (payload.method === "tools/call") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { content: [{ type: "text", text: "ok" }] } }));
        return;
      }

      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: {} }));
    });
    cleanups.push(() => closeServer(upstream.server));

    const config = defaultConfig();
    config.servers.circleback = {
      transport: "http",
      url: `http://127.0.0.1:${upstream.port}/mcp`
    };
    saveConfig(config);

    const gateway = createGatewayServer({
      port: 0,
      expectedToken: "test-local-token",
      secrets: new SecretsManager()
    });
    await waitForListening(gateway);
    cleanups.push(() => closeServer(gateway));

    const gatewayAddress = gateway.address();
    if (!gatewayAddress || typeof gatewayAddress === "string") {
      throw new Error("Failed to resolve gateway address.");
    }

    const baseUrl = `http://127.0.0.1:${gatewayAddress.port}/mcp`;

    const firstList = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer test-local-token"
      },
      body: modernRpcBody("tools/list", 1)
    });
    const firstPayload = (await firstList.json()) as { result: { tools: Array<{ name: string }> } };
    expect(firstPayload.result.tools.map((tool) => tool.name)).toContain("echo");

    delete config.servers.circleback;
    saveConfig(config);

    const secondList = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer test-local-token"
      },
      body: modernRpcBody("tools/list", 2)
    });
    const secondPayload = (await secondList.json()) as { result: { tools: Array<{ name: string }> } };
    expect(secondPayload.result.tools).toHaveLength(0);
  });

  it("keeps namespaced tools when multiple upstream servers are configured", async () => {
    const env = setupTempEnv("mcpx-gateway-multi-");
    cleanups.push(env.restore);

    const upstream = await startServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }

      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { method: string; id: string | number | null };
      if (payload.method === "server/discover") {
        respondWithDiscover(res, payload.id);
        return;
      }

      if (payload.method === "tools/list") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }] } }));
        return;
      }

      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: {} }));
    });
    cleanups.push(() => closeServer(upstream.server));

    const config = defaultConfig();
    config.servers.circleback = {
      transport: "http",
      url: `http://127.0.0.1:${upstream.port}/mcp`
    };
    config.servers.vercel = {
      transport: "http",
      url: `http://127.0.0.1:${upstream.port}/mcp`
    };
    saveConfig(config);

    const gateway = createGatewayServer({
      port: 0,
      expectedToken: "test-local-token",
      secrets: new SecretsManager()
    });
    await waitForListening(gateway);
    cleanups.push(() => closeServer(gateway));

    const gatewayAddress = gateway.address();
    if (!gatewayAddress || typeof gatewayAddress === "string") {
      throw new Error("Failed to resolve gateway address.");
    }

    const response = await fetch(`http://127.0.0.1:${gatewayAddress.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer test-local-token"
      },
      body: modernRpcBody("tools/list", 1)
    });

    const payload = (await response.json()) as { result: { tools: Array<{ name: string }> } };
    const toolNames = payload.result.tools.map((tool) => tool.name);
    expect(toolNames).toContain("circleback.echo");
    expect(toolNames).toContain("vercel.echo");
  });

  it("hides disabled upstreams from list responses and scoped calls", async () => {
    const env = setupTempEnv("mcpx-gateway-disabled-http-");
    cleanups.push(env.restore);

    const upstream = await startServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }

      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { method: string; id: string | number | null };
      if (payload.method === "tools/list") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }] } }));
        return;
      }

      if (payload.method === "tools/call") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { ok: true } }));
        return;
      }

      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: {} }));
    });
    cleanups.push(() => closeServer(upstream.server));

    const config = defaultConfig();
    config.servers.circleback = {
      transport: "http",
      url: `http://127.0.0.1:${upstream.port}/mcp`,
      enabled: false
    };
    saveConfig(config);

    const gateway = createGatewayServer({
      port: 0,
      expectedToken: "test-local-token",
      secrets: new SecretsManager()
    });
    await waitForListening(gateway);
    cleanups.push(() => closeServer(gateway));

    const address = gateway.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve gateway address.");
    }

    const listResponse = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer test-local-token"
      },
      body: modernRpcBody("tools/list", 1)
    });
    const listPayload = (await listResponse.json()) as { result: { tools: Array<{ name: string }> } };
    expect(listPayload.result.tools).toEqual([]);

    const scopedResponse = await fetch(`http://127.0.0.1:${address.port}/mcp?upstream=circleback`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer test-local-token"
      },
      body: modernRpcBody("tools/call", 2, { name: "echo", arguments: { text: "hello" } })
    });
    const scopedPayload = (await scopedResponse.json()) as { error?: { message?: string } };
    expect(scopedPayload.error?.message).toContain("Unknown upstream");
  });

  it("supports stdio upstream server passthrough", async () => {
    const env = setupTempEnv("mcpx-gateway-stdio-");
    cleanups.push(env.restore);

    const fixturePath = fileURLToPath(new URL("./fixtures/mock-stdio-mcp-server.cjs", import.meta.url));

    const config = defaultConfig();
    config.servers.next_devtools = {
      transport: "stdio",
      command: process.execPath,
      args: [fixturePath]
    };
    saveConfig(config);

    const gateway = createGatewayServer({
      port: 0,
      expectedToken: "test-local-token",
      secrets: new SecretsManager()
    });
    await waitForListening(gateway);
    cleanups.push(() => closeServer(gateway));

    const gatewayAddress = gateway.address();
    if (!gatewayAddress || typeof gatewayAddress === "string") {
      throw new Error("Failed to resolve gateway address.");
    }

    const baseUrl = `http://127.0.0.1:${gatewayAddress.port}/mcp`;

    const listResponse = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer test-local-token"
      },
      body: modernRpcBody("tools/list", 1)
    });
    expect(listResponse.status).toBe(200);
    const listPayload = (await listResponse.json()) as { result: { tools: Array<{ name: string }> } };
    expect(listPayload.result.tools.map((tool) => tool.name)).toContain("echo");

    const callResponse = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer test-local-token"
      },
      body: modernRpcBody("tools/call", 2, { name: "echo", arguments: { text: "hello-stdio" } })
    });
    expect(callResponse.status).toBe(200);
    const callPayload = (await callResponse.json()) as {
      result: {
        content?: Array<{ type?: string; text?: string }>;
      };
    };
    const textOutput = (callPayload.result.content ?? [])
      .filter((item) => item.type === "text")
      .map((item) => item.text);
    expect(textOutput).toContain("hello-stdio");
  });

  it("removes disabled stdio upstreams from the active catalog immediately", async () => {
    const env = setupTempEnv("mcpx-gateway-disabled-stdio-");
    cleanups.push(env.restore);

    const fixturePath = fileURLToPath(new URL("./fixtures/mock-stdio-mcp-server.cjs", import.meta.url));

    const config = defaultConfig();
    config.servers.next_devtools = {
      transport: "stdio",
      command: process.execPath,
      args: [fixturePath]
    };
    saveConfig(config);

    const gateway = createGatewayServer({
      port: 0,
      expectedToken: "test-local-token",
      secrets: new SecretsManager()
    });
    await waitForListening(gateway);
    cleanups.push(() => closeServer(gateway));

    const gatewayAddress = gateway.address();
    if (!gatewayAddress || typeof gatewayAddress === "string") {
      throw new Error("Failed to resolve gateway address.");
    }

    const baseUrl = `http://127.0.0.1:${gatewayAddress.port}/mcp`;

    const firstList = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer test-local-token"
      },
      body: modernRpcBody("tools/list", 1)
    });
    const firstPayload = (await firstList.json()) as { result: { tools: Array<{ name: string }> } };
    expect(firstPayload.result.tools.map((tool) => tool.name)).toContain("echo");

    config.servers.next_devtools.enabled = false;
    saveConfig(config);

    const secondList = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer test-local-token"
      },
      body: modernRpcBody("tools/list", 2)
    });
    const secondPayload = (await secondList.json()) as { result: { tools: Array<{ name: string }> } };
    expect(secondPayload.result.tools).toEqual([]);
  });

  it("rejects unauthorized local client requests", async () => {
    const env = setupTempEnv("mcpx-gateway-auth-");
    cleanups.push(env.restore);

    const gateway = createGatewayServer({
      port: 0,
      expectedToken: "correct-token",
      secrets: new SecretsManager()
    });
    await waitForListening(gateway);
    cleanups.push(() => closeServer(gateway));

    const address = gateway.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve gateway address.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer wrong-token"
      },
      body: modernRpcBody("tools/list", 1)
    });

    expect(response.status).toBe(401);
    const payload = (await response.json()) as { error?: string };
    expect(payload.error).toBe("unauthorized");
  });

  it("rejects a same-length wrong bearer token (exercises the timing-safe comparison path, not just a length mismatch)", async () => {
    const env = setupTempEnv("mcpx-gateway-auth-samelen-");
    cleanups.push(env.restore);

    const gateway = createGatewayServer({
      port: 0,
      expectedToken: "correct-token",
      secrets: new SecretsManager()
    });
    await waitForListening(gateway);
    cleanups.push(() => closeServer(gateway));

    const address = gateway.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve gateway address.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Same length as "correct-token" (13 chars) so timingSafeEqual actually
        // runs a byte comparison instead of short-circuiting on length.
        Authorization: "Bearer wrong-token-x"
      },
      body: modernRpcBody("tools/list", 1)
    });

    expect(response.status).toBe(401);
  });

  it("accepts x-mcpx-local-token for local gateway auth", async () => {
    const env = setupTempEnv("mcpx-gateway-local-header-");
    cleanups.push(env.restore);

    const upstream = await startServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }

      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { method: string; id: string | number | null };
      if (payload.method === "server/discover") {
        respondWithDiscover(res, payload.id);
        return;
      }

      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { tools: [{ name: "echo", inputSchema: { type: "object" } }] } }));
    });
    cleanups.push(() => closeServer(upstream.server));

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: `http://127.0.0.1:${upstream.port}/mcp`
    };
    saveConfig(config);

    const gateway = createGatewayServer({
      port: 0,
      expectedToken: "correct-token",
      secrets: new SecretsManager()
    });
    await waitForListening(gateway);
    cleanups.push(() => closeServer(gateway));

    const address = gateway.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve gateway address.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mcpx-local-token": "correct-token"
      },
      body: modernRpcBody("tools/list", 1)
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { result: { tools: Array<{ name: string }> } };
    expect(payload.result.tools.map((tool) => tool.name)).toContain("echo");
  });

  it("passes through upstream OAuth challenge and forwards client Authorization", async () => {
    const env = setupTempEnv("mcpx-gateway-oauth-pass-");
    cleanups.push(env.restore);

    const upstream = await startServer(async (req, res) => {
      const auth = req.headers.authorization;
      if (auth !== "Bearer upstream-token") {
        res.statusCode = 401;
        res.setHeader("content-type", "application/json");
        res.setHeader(
          "www-authenticate",
          'Bearer error="invalid_token", resource_metadata="https://mcp.vercel.com/.well-known/oauth-protected-resource"'
        );
        res.end(JSON.stringify({ error: "invalid_token", error_description: "No authorization provided" }));
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { method: string; id: string | number | null };

      if (payload.method === "server/discover") {
        respondWithDiscover(res, payload.id);
        return;
      }

      if (payload.method === "tools/list") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { tools: [{ name: "echo", inputSchema: { type: "object" } }] } }));
        return;
      }

      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: {} }));
    });
    cleanups.push(() => closeServer(upstream.server));

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: `http://127.0.0.1:${upstream.port}/mcp`
    };
    saveConfig(config);

    const gateway = createGatewayServer({
      port: 0,
      expectedToken: "local-token",
      secrets: new SecretsManager()
    });
    await waitForListening(gateway);
    cleanups.push(() => closeServer(gateway));

    const address = gateway.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve gateway address.");
    }

    const authChallengeResponse = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mcpx-local-token": "local-token"
      },
      body: modernRpcBody("tools/list", 1)
    });
    expect(authChallengeResponse.status).toBe(401);
    expect(authChallengeResponse.headers.get("www-authenticate")).toContain("resource_metadata");

    const authorizedResponse = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mcpx-local-token": "local-token",
        Authorization: "Bearer upstream-token"
      },
      body: modernRpcBody("tools/list", 2)
    });

    expect(authorizedResponse.status).toBe(200);
    const payload = (await authorizedResponse.json()) as { result: { tools: Array<{ name: string }> } };
    expect(payload.result.tools.map((tool) => tool.name)).toContain("echo");
  });

  it("returns deterministic missing-secret errors for routed tool calls", async () => {
    const env = setupTempEnv("mcpx-gateway-secret-");
    cleanups.push(env.restore);

    const upstream = await startServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }

      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { id: string | number | null };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { ok: true } }));
    });
    cleanups.push(() => closeServer(upstream.server));

    const config = defaultConfig();
    config.servers.circleback = {
      transport: "http",
      url: `http://127.0.0.1:${upstream.port}/mcp`,
      headers: {
        Authorization: "secret://missing_token"
      }
    };
    saveConfig(config);

    const gateway = createGatewayServer({
      port: 0,
      expectedToken: "test-local-token",
      secrets: new SecretsManager()
    });
    await waitForListening(gateway);
    cleanups.push(() => closeServer(gateway));

    const address = gateway.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve gateway address.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer test-local-token"
      },
      body: modernRpcBody("tools/call", 1, { name: "circleback.echo", arguments: { value: "hi" } })
    });

    const payload = (await response.json()) as { error: { code: number; message: string } };
    expect(payload.error.code).toBe(-32000);
    expect(payload.error.message).toContain("Secret not found");
  });

  it("accepts flattened tool names for routed calls when only one upstream exists", async () => {
    const env = setupTempEnv("mcpx-gateway-flat-call-");
    cleanups.push(env.restore);

    let upstreamToolName = "";
    const upstream = await startServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }

      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        id: string | number | null;
        method: string;
        params?: { name?: string };
      };
      if (payload.method === "server/discover") {
        respondWithDiscover(res, payload.id);
        return;
      }

      if (payload.method === "tools/call") {
        upstreamToolName = payload.params?.name ?? "";
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { content: [{ type: "text", text: "ok" }] } }));
        return;
      }

      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: {} }));
    });
    cleanups.push(() => closeServer(upstream.server));

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: `http://127.0.0.1:${upstream.port}/mcp`
    };
    saveConfig(config);

    const gateway = createGatewayServer({
      port: 0,
      expectedToken: "test-local-token",
      secrets: new SecretsManager()
    });
    await waitForListening(gateway);
    cleanups.push(() => closeServer(gateway));

    const address = gateway.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve gateway address.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer test-local-token"
      },
      body: modernRpcBody("tools/call", 1, { name: "explain_vercel_concept" })
    });

    expect(response.status).toBe(200);
    expect(upstreamToolName).toBe("explain_vercel_concept");
  });

  it("proxies OAuth protected resource metadata endpoint for single-upstream mode", async () => {
    const env = setupTempEnv("mcpx-gateway-oauth-wk-");
    cleanups.push(env.restore);

    let requestedPath = "";
    const upstream = await startServer(async (req, res) => {
      requestedPath = req.url ?? "";
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ resource: "https://example.com/" }));
    });
    cleanups.push(() => closeServer(upstream.server));

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: `http://127.0.0.1:${upstream.port}/mcp`,
      headers: {
        Authorization: "Bearer test-token"
      }
    };
    saveConfig(config);

    const gateway = createGatewayServer({
      port: 0,
      expectedToken: "test-local-token",
      secrets: new SecretsManager()
    });
    await waitForListening(gateway);
    cleanups.push(() => closeServer(gateway));

    const gatewayAddress = gateway.address();
    if (!gatewayAddress || typeof gatewayAddress === "string") {
      throw new Error("Failed to resolve gateway address.");
    }

    const response = await fetch(`http://127.0.0.1:${gatewayAddress.port}/.well-known/oauth-protected-resource`);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { resource: string };
    expect(payload.resource).toBe(`http://127.0.0.1:${gatewayAddress.port}/mcp`);
    expect(requestedPath).toBe("/.well-known/oauth-protected-resource/mcp");
  });

  it("returns a clean 502 instead of hanging or crashing when the upstream well-known endpoint is unreachable", async () => {
    // Regression test: this fetch used to have no AbortController/timeout and
    // no try/catch, unlike every other outbound fetch in the gateway.
    const env = setupTempEnv("mcpx-gateway-oauth-wk-unreachable-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: "http://127.0.0.1:1/mcp", // reserved port, refuses connections
      headers: { Authorization: "Bearer test-token" }
    };
    saveConfig(config);

    const gateway = createGatewayServer({ port: 0, expectedToken: "test-local-token", secrets: new SecretsManager() });
    await waitForListening(gateway);
    cleanups.push(() => closeServer(gateway));

    const gatewayAddress = gateway.address();
    if (!gatewayAddress || typeof gatewayAddress === "string") {
      throw new Error("Failed to resolve gateway address.");
    }

    const response = await fetch(`http://127.0.0.1:${gatewayAddress.port}/.well-known/oauth-protected-resource`);

    expect(response.status).toBe(502);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toBe("upstream_unreachable");
  });

  it("resolves an oauth:// Authorization binding to a real bearer token when proxying the well-known request", async () => {
    // Regression test: resolveMaybeSecret only understands secret:// refs, so
    // an oauth:// binding used to be forwarded to the upstream verbatim as
    // the literal header value "Authorization: oauth://<name>".
    const env = setupTempEnv("mcpx-gateway-oauth-wk-oauthref-");
    cleanups.push(env.restore);

    let receivedAuth = "";
    const upstream = await startServer(async (req, res) => {
      receivedAuth = req.headers.authorization ?? "";
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ resource: "https://example.com/" }));
    });
    cleanups.push(() => closeServer(upstream.server));

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: `http://127.0.0.1:${upstream.port}/mcp`,
      headers: { Authorization: "oauth://vercel" }
    };
    saveConfig(config);

    const secrets = new MemorySecrets();
    secrets.setSecret("oauth_vercel_tokens", JSON.stringify({
      tokens: { access_token: "well-known-token", token_type: "Bearer", expires_in: 3600 },
      obtainedAt: Date.now()
    }));

    const gateway = createGatewayServer({ port: 0, expectedToken: "test-local-token", secrets });
    await waitForListening(gateway);
    cleanups.push(() => closeServer(gateway));

    const gatewayAddress = gateway.address();
    if (!gatewayAddress || typeof gatewayAddress === "string") {
      throw new Error("Failed to resolve gateway address.");
    }

    const response = await fetch(`http://127.0.0.1:${gatewayAddress.port}/.well-known/oauth-protected-resource`);

    expect(response.status).toBe(200);
    expect(receivedAuth).toBe("Bearer well-known-token");
  });

  it("rewrites upstream WWW-Authenticate resource_metadata to local gateway endpoint", async () => {
    const env = setupTempEnv("mcpx-gateway-auth-rewrite-");
    cleanups.push(env.restore);

    const upstream = await startServer(async (_req, res) => {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.setHeader(
        "www-authenticate",
        'Bearer error="invalid_token", resource_metadata="https://mcp.vercel.com/.well-known/oauth-protected-resource"'
      );
      res.end(JSON.stringify({ error: "invalid_token" }));
    });
    cleanups.push(() => closeServer(upstream.server));

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: `http://127.0.0.1:${upstream.port}/mcp`
    };
    saveConfig(config);

    const gateway = createGatewayServer({
      port: 0,
      expectedToken: "test-local-token",
      secrets: new SecretsManager()
    });
    await waitForListening(gateway);
    cleanups.push(() => closeServer(gateway));

    const gatewayAddress = gateway.address();
    if (!gatewayAddress || typeof gatewayAddress === "string") {
      throw new Error("Failed to resolve gateway address.");
    }

    const response = await fetch(`http://127.0.0.1:${gatewayAddress.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mcpx-local-token": "test-local-token"
      },
      body: modernRpcBody("tools/list", 1)
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      `resource_metadata="http://127.0.0.1:${gatewayAddress.port}/.well-known/oauth-protected-resource"`
    );
  });

  it("calculates, caches, and returns /internal/token-counts correctly", async () => {
    const env = setupTempEnv("mcpx-gateway-tokens-");
    cleanups.push(env.restore);

    const upstream = await startServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }

      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { method: string; id: string | number | null };
      if (payload.method === "server/discover") {
        respondWithDiscover(res, payload.id);
        return;
      }

      if (payload.method === "tools/list") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }] } }));
        return;
      }

      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: {} }));
    });
    cleanups.push(() => closeServer(upstream.server));

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: `http://127.0.0.1:${upstream.port}/mcp`
    };
    saveConfig(config);

    const gateway = createGatewayServer({
      port: 0,
      expectedToken: "test-local-token",
      secrets: new SecretsManager()
    });
    await waitForListening(gateway);
    cleanups.push(() => closeServer(gateway));

    const address = gateway.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve gateway address.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/token-counts`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer test-local-token"
      }
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { counts: Record<string, { tools: number; resources: number; prompts: number; total: number }> };
    expect(payload.counts.vercel).toBeDefined();
    expect(payload.counts.vercel.tools).toBeGreaterThan(0);
    expect(payload.counts.vercel.total).toBe(payload.counts.vercel.tools);
  });

  it("populates errorCode on /internal/token-counts with the classified error, not just the message", async () => {
    const env = setupTempEnv("mcpx-gateway-tokencounts-errorcode-");
    cleanups.push(env.restore);

    // Every request -- including the initial MCP handshake -- is rejected as
    // unauthorized, so each of tools/list, resources/list, and prompts/list
    // surfaces a classified auth_required UpstreamError.
    const upstream = await startServer((_req, res) => {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "unauthorized" }));
    });
    cleanups.push(() => closeServer(upstream.server));

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: `http://127.0.0.1:${upstream.port}/mcp`
    };
    saveConfig(config);

    const gateway = createGatewayServer({
      port: 0,
      expectedToken: "test-local-token",
      secrets: new SecretsManager()
    });
    await waitForListening(gateway);
    cleanups.push(() => closeServer(gateway));

    const address = gateway.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve gateway address.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/internal/token-counts`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer test-local-token"
      },
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { counts: Record<string, { error?: string; errorCode?: string }> };
    expect(payload.counts.vercel.error).toBeTruthy();
    expect(payload.counts.vercel.errorCode).toBe("auth_required");
  });

  it("resolves oauth references and refreshes once after an upstream 401", async () => {
    const env = setupTempEnv("mcpx-gateway-oauth-refresh-");
    cleanups.push(env.restore);

    let tokenRequests = 0;
    const upstream = await startServer(async (req, res) => {
      if (req.url === "/token") {
        tokenRequests += 1;
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.from(chunk));
        }
        const body = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
        expect(body.get("grant_type")).toBe("refresh_token");
        expect(body.get("refresh_token")).toBe("refresh-token");
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          access_token: "new-token",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "refresh-token"
        }));
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { method: string; id: string | number | null };
      if (req.headers.authorization !== "Bearer new-token") {
        res.statusCode = 401;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "expired" }));
        return;
      }

      if (payload.method === "server/discover") {
        respondWithDiscover(res, payload.id);
        return;
      }

      if (payload.id === undefined || payload.id === null) {
        // notification (e.g. notifications/initialized) — no response needed
        res.statusCode = 202;
        res.end();
        return;
      }

      expect(payload.method).toBe("tools/list");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { tools: [{ name: "echo", inputSchema: { type: "object" } }] } }));
    });
    cleanups.push(() => closeServer(upstream.server));

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: `http://127.0.0.1:${upstream.port}/mcp`,
      headers: {
        Authorization: "oauth://vercel"
      }
    };
    saveConfig(config);

    const secrets = new MemorySecrets();
    secrets.setSecret("oauth_vercel_client", JSON.stringify({ client_id: "client-id", token_endpoint_auth_method: "none" }));
    secrets.setSecret("oauth_vercel_tokens", JSON.stringify({
      tokens: {
        access_token: "old-token",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "refresh-token"
      },
      obtainedAt: Date.now()
    }));
    secrets.setSecret("oauth_vercel_discovery", JSON.stringify({
      authorizationServerUrl: `http://127.0.0.1:${upstream.port}`,
      authorizationServerMetadata: {
        issuer: `http://127.0.0.1:${upstream.port}`,
        authorization_endpoint: `http://127.0.0.1:${upstream.port}/authorize`,
        token_endpoint: `http://127.0.0.1:${upstream.port}/token`,
        response_types_supported: ["code"],
        token_endpoint_auth_methods_supported: ["none"]
      }
    }));

    const gateway = createGatewayServer({
      port: 0,
      expectedToken: "test-local-token",
      secrets
    });
    await waitForListening(gateway);
    cleanups.push(() => closeServer(gateway));

    const address = gateway.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve gateway address.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/mcp?upstream=vercel`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer test-local-token"
      },
      body: modernRpcBody("tools/list", 1)
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { result: { tools: Array<{ name: string }> } };
    expect(payload.result.tools.map((t: { name: string }) => t.name)).toEqual(["echo"]);
    expect(tokenRequests).toBe(1);
    expect(JSON.parse(secrets.getSecret("oauth_vercel_tokens") ?? "{}").tokens.access_token).toBe("new-token");
  });

  it("surfaces stdio call-time upstream errors as runtimeError in /internal/token-counts", async () => {
    const env = setupTempEnv("mcpx-gateway-runtime-error-");
    cleanups.push(env.restore);

    const flagPath = path.join(env.root, "fail-flag");
    fs.writeFileSync(flagPath, "1", "utf8");

    const fixturePath = fileURLToPath(new URL("./fixtures/mock-stdio-call-error-server.cjs", import.meta.url));

    const config = defaultConfig();
    config.servers.Railway = {
      transport: "stdio",
      command: process.execPath,
      args: [fixturePath],
      env: { MOCK_CALL_FAIL_FLAG: flagPath }
    };
    saveConfig(config);

    const gateway = createGatewayServer({
      port: 0,
      expectedToken: "test-local-token",
      secrets: new SecretsManager()
    });
    await waitForListening(gateway);
    cleanups.push(() => closeServer(gateway));

    const gatewayAddress = gateway.address();
    if (!gatewayAddress || typeof gatewayAddress === "string") {
      throw new Error("Failed to resolve gateway address.");
    }

    const baseUrl = `http://127.0.0.1:${gatewayAddress.port}/mcp`;
    const authHeader = { "content-type": "application/json", Authorization: "Bearer test-local-token" };

    // tools/list succeeds (listing needs no auth).
    const listResponse = await fetch(baseUrl, {
      method: "POST",
      headers: authHeader,
      body: modernRpcBody("tools/list", 1)
    });
    expect(listResponse.status).toBe(200);
    const listPayload = (await listResponse.json()) as { result: { tools: Array<{ name: string }> } };
    expect(listPayload.result.tools.map((tool) => tool.name)).toContain("whoami");

    // tools/call fails with the upstream's auth error.
    const failCallResponse = await fetch(baseUrl, {
      method: "POST",
      headers: authHeader,
      body: modernRpcBody("tools/call", 2, { name: "whoami", arguments: {} })
    });
    expect(failCallResponse.status).toBe(200);
    const failCallPayload = (await failCallResponse.json()) as { error: { code: number; message: string } };
    expect(failCallPayload.error.code).toBe(-32000);
    expect(failCallPayload.error.message).toContain("Not authenticated");

    // The private token-count endpoint reflects the call-time error as runtimeError while the
    // list still succeeds (total > 0, no method-level error).
    const failTokensResponse = await fetch(baseUrl.replace("/mcp", "/internal/token-counts"), {
      method: "POST",
      headers: authHeader,
    });
    expect(failTokensResponse.status).toBe(200);
    const failTokensPayload = (await failTokensResponse.json()) as {
      counts: Record<string, { total: number; error?: string; runtimeError?: string }>;
    };
    expect(failTokensPayload.counts.Railway).toBeDefined();
    expect(failTokensPayload.counts.Railway.total).toBeGreaterThan(0);
    expect(failTokensPayload.counts.Railway.error).toBeUndefined();
    expect(failTokensPayload.counts.Railway.runtimeError).toBeDefined();
    expect(failTokensPayload.counts.Railway.runtimeError).toContain("Not authenticated");

    // Clear the flag so the next call succeeds, clearing the recorded runtime error.
    fs.writeFileSync(flagPath, "0", "utf8");

    const okCallResponse = await fetch(baseUrl, {
      method: "POST",
      headers: authHeader,
      body: modernRpcBody("tools/call", 4, { name: "whoami", arguments: {} })
    });
    expect(okCallResponse.status).toBe(200);
    const okCallPayload = (await okCallResponse.json()) as { result?: unknown; error?: { code: number } };
    expect(okCallPayload.error).toBeUndefined();

    const okTokensResponse = await fetch(baseUrl.replace("/mcp", "/internal/token-counts"), {
      method: "POST",
      headers: authHeader,
    });
    expect(okTokensResponse.status).toBe(200);
    const okTokensPayload = (await okTokensResponse.json()) as {
      counts: Record<string, { total: number; error?: string; runtimeError?: string }>;
    };
    expect(okTokensPayload.counts.Railway.runtimeError).toBeUndefined();
  });

  it("builds a well-known upstream URL without a double slash when the upstream URL has a trailing slash", async () => {
    const env = setupTempEnv("mcpx-gateway-wk-trailing-slash-");
    cleanups.push(env.restore);

    let requestedPath = "";
    const upstream = await startServer(async (req, res) => {
      requestedPath = req.url ?? "";
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ resource: "https://example.com/" }));
    });
    cleanups.push(() => closeServer(upstream.server));

    const config = defaultConfig();
    // Trailing slash on the upstream URL is the regression case: naive string
    // concatenation of "<prefix>" + "<pathname>" would produce a "//" here.
    config.servers.vercel = {
      transport: "http",
      url: `http://127.0.0.1:${upstream.port}/mcp/`,
      headers: {
        Authorization: "Bearer test-token"
      }
    };
    // A second upstream ensures the request is actually resolved via the
    // `?upstream=vercel` filter rather than an implicit single-upstream fallback.
    config.servers.other = {
      transport: "http",
      url: `http://127.0.0.1:${upstream.port}/other`
    };
    saveConfig(config);

    const gateway = createGatewayServer({
      port: 0,
      expectedToken: "test-local-token",
      secrets: new SecretsManager()
    });
    await waitForListening(gateway);
    cleanups.push(() => closeServer(gateway));

    const gatewayAddress = gateway.address();
    if (!gatewayAddress || typeof gatewayAddress === "string") {
      throw new Error("Failed to resolve gateway address.");
    }

    const response = await fetch(
      `http://127.0.0.1:${gatewayAddress.port}/.well-known/oauth-protected-resource?upstream=vercel`
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { resource: string };
    expect(payload.resource).toBe(`http://127.0.0.1:${gatewayAddress.port}/mcp?upstream=vercel`);

    // requestedPath is the raw path+query the gateway sent to the fake upstream
    // (no "http://" scheme present), so any "//" here is a genuine double-slash bug.
    expect(requestedPath).toBe("/.well-known/oauth-protected-resource/mcp");
    expect(requestedPath).not.toContain("//");
  });

  it("surfaces mcpxUpstreamErrors in tools/list _meta when one of several upstreams fails", async () => {
    const env = setupTempEnv("mcpx-gateway-partial-fail-");
    cleanups.push(env.restore);

    const healthyUpstream = await startServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }

      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { method: string; id: string | number | null };
      if (payload.method === "server/discover") {
        respondWithDiscover(res, payload.id);
        return;
      }

      if (payload.method === "tools/list") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }] } }));
        return;
      }

      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: {} }));
    });
    cleanups.push(() => closeServer(healthyUpstream.server));

    // Bind an ephemeral port, then close it immediately so nothing is
    // listening there. Connecting to it fails fast with ECONNREFUSED,
    // giving us a deterministic "unreachable" upstream.
    const deadServer = await startServer(() => {});
    const deadPort = deadServer.port;
    await closeServer(deadServer.server);

    const config = defaultConfig();
    config.servers.good = {
      transport: "http",
      url: `http://127.0.0.1:${healthyUpstream.port}/mcp`
    };
    config.servers.bad = {
      transport: "http",
      url: `http://127.0.0.1:${deadPort}/mcp`
    };
    saveConfig(config);

    const gateway = createGatewayServer({
      port: 0,
      expectedToken: "test-local-token",
      secrets: new SecretsManager()
    });
    await waitForListening(gateway);
    cleanups.push(() => closeServer(gateway));

    const gatewayAddress = gateway.address();
    if (!gatewayAddress || typeof gatewayAddress === "string") {
      throw new Error("Failed to resolve gateway address.");
    }

    const response = await fetch(`http://127.0.0.1:${gatewayAddress.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer test-local-token"
      },
      body: modernRpcBody("tools/list", 1)
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      result: {
        tools: Array<{ name: string }>;
        _meta?: { mcpxUpstreamErrors?: Array<{ name: string; code: string; message: string }> };
      };
    };

    const toolNames = payload.result.tools.map((tool) => tool.name);
    expect(toolNames).toContain("good.echo");
    expect(toolNames.some((name) => name.startsWith("bad."))).toBe(false);

    expect(payload.result._meta?.mcpxUpstreamErrors).toBeDefined();
    const failedUpstreams = payload.result._meta?.mcpxUpstreamErrors ?? [];
    expect(failedUpstreams.map((entry) => entry.name)).toEqual(["bad"]);
    expect(failedUpstreams[0]?.code).toBe("unreachable");
    expect(typeof failedUpstreams[0]?.message).toBe("string");
    expect(failedUpstreams[0]?.message.length).toBeGreaterThan(0);
  });

  it("rejects legacy and batched MCP HTTP traffic", async () => {
    const env = setupTempEnv("mcpx-gateway-sse-");
    cleanups.push(env.restore);

    const upstream = await startServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }

      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { method: string; id: string | number | null };
      if (payload.method === "server/discover") {
        respondWithDiscover(res, payload.id);
        return;
      }

      if (payload.method === "tools/list") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }] } }));
        return;
      }

      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: {} }));
    });
    cleanups.push(() => closeServer(upstream.server));

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: `http://127.0.0.1:${upstream.port}/mcp`
    };
    saveConfig(config);

    const gateway = createGatewayServer({
      port: 0,
      expectedToken: "test-local-token",
      secrets: new SecretsManager()
    });
    await waitForListening(gateway);
    cleanups.push(() => closeServer(gateway));

    const gatewayAddress = gateway.address();
    if (!gatewayAddress || typeof gatewayAddress === "string") {
      throw new Error("Failed to resolve gateway address.");
    }

    const response = await fetch(`http://127.0.0.1:${gatewayAddress.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer test-local-token"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    });

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error?: { code?: number } };
    expect(payload.error?.code).toBe(-32022);
  });

  it("picks up a re-authenticated OAuth token on the very next call, without needing an intervening 401", async () => {
    // Regression test: specFingerprint() used to be called with no `secrets`
    // argument anywhere in the file, so the "has this upstream's resolved
    // credential changed?" check always fell back to JSON.stringify(spec) --
    // which is identical before and after a re-login, since bindOAuthReference
    // writes a constant "oauth://<name>" string. The gateway kept serving
    // requests through the connection cached with the OLD access token baked
    // into its transport until some unrelated event happened to evict it, so
    // re-authenticating looked like it silently did nothing.
    const env = setupTempEnv("mcpx-gateway-reauth-fingerprint-");
    cleanups.push(env.restore);

    const receivedTokens: string[] = [];
    const upstream = await startServer(async (req, res) => {
      receivedTokens.push(req.headers.authorization ?? "");
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { method: string; id: string | number | null };
      if (payload.method === "server/discover") {
        respondWithDiscover(res, payload.id);
        return;
      }
      if (payload.id === undefined || payload.id === null) {
        res.statusCode = 202;
        res.end();
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { tools: [{ name: "echo", inputSchema: { type: "object" } }] } }));
    });
    cleanups.push(() => closeServer(upstream.server));

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: `http://127.0.0.1:${upstream.port}/mcp`,
      headers: { Authorization: "oauth://vercel" }
    };
    saveConfig(config);

    const secrets = new MemorySecrets();
    secrets.setSecret("oauth_vercel_client", JSON.stringify({ client_id: "client-id", token_endpoint_auth_method: "none" }));
    secrets.setSecret("oauth_vercel_tokens", JSON.stringify({
      tokens: { access_token: "token-a", token_type: "Bearer", expires_in: 3600 },
      obtainedAt: Date.now()
    }));

    const gateway = createGatewayServer({ port: 0, expectedToken: "test-local-token", secrets });
    await waitForListening(gateway);
    cleanups.push(() => closeServer(gateway));

    const address = gateway.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve gateway address.");
    }

    const call = () =>
      fetch(`http://127.0.0.1:${address.port}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: "Bearer test-local-token" },
      body: modernRpcBody("tools/list", 1)
      });

    const first = await call();
    expect(first.status).toBe(200);
    expect(receivedTokens.at(-1)).toBe("Bearer token-a");

    // Simulate `mcpx auth login vercel` completing out-of-band (e.g. in a
    // separate mcpx process) -- a fresh token with no 401 ever occurring.
    secrets.setSecret("oauth_vercel_tokens", JSON.stringify({
      tokens: { access_token: "token-b", token_type: "Bearer", expires_in: 3600 },
      obtainedAt: Date.now() + 1000
    }));

    const second = await call();
    expect(second.status).toBe(200);
    expect(receivedTokens.at(-1)).toBe("Bearer token-b");
  });

  it("does not let two clients' different passthrough tokens for the same upstream share a cached connection", async () => {
    // Regression test: the passthrough connection cache key used to be a
    // constant "<name>:passthrough" that didn't depend on the token itself,
    // so whichever client connected first "won" and the second client's
    // calls silently executed under the first client's credentials for the
    // life of that cached connection.
    const env = setupTempEnv("mcpx-gateway-passthrough-isolation-");
    cleanups.push(env.restore);

    const toolsListTokens: string[] = [];
    const upstream = await startServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { method: string; id: string | number | null };
      if (payload.method === "server/discover") {
        respondWithDiscover(res, payload.id);
        return;
      }
      if (payload.id === undefined || payload.id === null) {
        res.statusCode = 202;
        res.end();
        return;
      }
      if (payload.method === "tools/list") {
        toolsListTokens.push(req.headers.authorization ?? "");
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { tools: [] } }));
    });
    cleanups.push(() => closeServer(upstream.server));

    // No auth header configured on the upstream at all -- the gateway's own
    // credential resolution stays out of the way, and passthrough (any
    // client Authorization that isn't the local gateway token) is the only
    // auth mechanism in play, which is exactly what this test targets.
    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: `http://127.0.0.1:${upstream.port}/mcp`
    };
    saveConfig(config);

    const gateway = createGatewayServer({ port: 0, expectedToken: "test-local-token", secrets: new SecretsManager() });
    await waitForListening(gateway);
    cleanups.push(() => closeServer(gateway));

    const address = gateway.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve gateway address.");
    }

    // x-mcpx-local-token authenticates to the gateway itself; Authorization
    // carries the per-client credential forwarded to the upstream (passthrough
    // is any Authorization value that isn't the local gateway token).
    const callAs = (clientToken: string) =>
      fetch(`http://127.0.0.1:${address.port}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-mcpx-local-token": "test-local-token",
          Authorization: `Bearer ${clientToken}`
        },
      body: modernRpcBody("tools/list", 1)
      });

    await callAs("client-a-token");
    await callAs("client-b-token");
    // Repeat client A -- if the cache were keyed only by upstream name, this
    // third call could reuse client B's cached connection instead of A's own.
    await callAs("client-a-token");

    expect(toolsListTokens).toEqual(["Bearer client-a-token", "Bearer client-b-token", "Bearer client-a-token"]);
  });
});
