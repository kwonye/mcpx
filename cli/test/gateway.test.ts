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
      if (payload.method === "initialize") {
        respondWithInit(res, payload.id);
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
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
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
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
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
      if (payload.method === "initialize") {
        respondWithInit(res, payload.id);
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
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
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
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    });
    const listPayload = (await listResponse.json()) as { result: { tools: Array<{ name: string }> } };
    expect(listPayload.result.tools).toEqual([]);

    const scopedResponse = await fetch(`http://127.0.0.1:${address.port}/mcp?upstream=circleback`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer test-local-token"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "echo", arguments: { text: "hello" } }
      })
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
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
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
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "echo", arguments: { text: "hello-stdio" } }
      })
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
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
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
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
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
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    });

    expect(response.status).toBe(401);
    const payload = (await response.json()) as { error: { code: number } };
    expect(payload.error.code).toBe(-32001);
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
      if (payload.method === "initialize") {
        respondWithInit(res, payload.id);
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
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
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

      if (payload.method === "initialize") {
        respondWithInit(res, payload.id);
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
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
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
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
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
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "circleback.echo",
          arguments: { value: "hi" }
        }
      })
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
      if (payload.method === "initialize") {
        respondWithInit(res, payload.id);
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
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "explain_vercel_concept"
        }
      })
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
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      `resource_metadata="http://127.0.0.1:${gatewayAddress.port}/.well-known/oauth-protected-resource"`
    );
  });

  it("calculates, caches, and returns custom/tokenCounts correctly", async () => {
    const env = setupTempEnv("mcpx-gateway-tokens-");
    cleanups.push(env.restore);

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

    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer test-local-token"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "custom/tokenCounts", params: {} })
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { result: Record<string, { tools: number; resources: number; prompts: number; total: number }> };
    expect(payload.result.vercel).toBeDefined();
    expect(payload.result.vercel.tools).toBeGreaterThan(0);
    expect(payload.result.vercel.total).toBe(payload.result.vercel.tools);
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

      if (payload.method === "initialize") {
        respondWithInit(res, payload.id);
        return;
      }

      if (!payload.id) {
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
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { result: { tools: Array<{ name: string }> } };
    expect(payload.result.tools.map((t: { name: string }) => t.name)).toEqual(["echo"]);
    expect(tokenRequests).toBe(1);
    expect(JSON.parse(secrets.getSecret("oauth_vercel_tokens") ?? "{}").tokens.access_token).toBe("new-token");
  });

  it("surfaces stdio call-time upstream errors as runtimeError in custom/tokenCounts", async () => {
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
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    });
    expect(listResponse.status).toBe(200);
    const listPayload = (await listResponse.json()) as { result: { tools: Array<{ name: string }> } };
    expect(listPayload.result.tools.map((tool) => tool.name)).toContain("whoami");

    // tools/call fails with the upstream's auth error.
    const failCallResponse = await fetch(baseUrl, {
      method: "POST",
      headers: authHeader,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "whoami", arguments: {} }
      })
    });
    expect(failCallResponse.status).toBe(200);
    const failCallPayload = (await failCallResponse.json()) as { error: { code: number; message: string } };
    expect(failCallPayload.error.code).toBe(-32000);
    expect(failCallPayload.error.message).toContain("Not authenticated");

    // custom/tokenCounts reflects the call-time error as runtimeError while the
    // list still succeeds (total > 0, no method-level error).
    const failTokensResponse = await fetch(baseUrl, {
      method: "POST",
      headers: authHeader,
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "custom/tokenCounts", params: {} })
    });
    expect(failTokensResponse.status).toBe(200);
    const failTokensPayload = (await failTokensResponse.json()) as {
      result: Record<string, { total: number; error?: string; runtimeError?: string }>;
    };
    expect(failTokensPayload.result.Railway).toBeDefined();
    expect(failTokensPayload.result.Railway.total).toBeGreaterThan(0);
    expect(failTokensPayload.result.Railway.error).toBeUndefined();
    expect(failTokensPayload.result.Railway.runtimeError).toBeDefined();
    expect(failTokensPayload.result.Railway.runtimeError).toContain("Not authenticated");

    // Clear the flag so the next call succeeds, clearing the recorded runtime error.
    fs.writeFileSync(flagPath, "0", "utf8");

    const okCallResponse = await fetch(baseUrl, {
      method: "POST",
      headers: authHeader,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "whoami", arguments: {} }
      })
    });
    expect(okCallResponse.status).toBe(200);
    const okCallPayload = (await okCallResponse.json()) as { result?: unknown; error?: { code: number } };
    expect(okCallPayload.error).toBeUndefined();

    const okTokensResponse = await fetch(baseUrl, {
      method: "POST",
      headers: authHeader,
      body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "custom/tokenCounts", params: {} })
    });
    expect(okTokensResponse.status).toBe(200);
    const okTokensPayload = (await okTokensResponse.json()) as {
      result: Record<string, { total: number; error?: string; runtimeError?: string }>;
    };
    expect(okTokensPayload.result.Railway.runtimeError).toBeUndefined();
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
      if (payload.method === "initialize") {
        respondWithInit(res, payload.id);
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
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
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

  it("returns well-formed SSE frames with one complete JSON-RPC payload per event for batched requests", async () => {
    const env = setupTempEnv("mcpx-gateway-sse-");
    cleanups.push(env.restore);

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

    // Batch of two requests forces the multi-response SSE path (one "event:
    // message" / "data:" frame per JSON-RPC response, in request order).
    const response = await fetch(`http://127.0.0.1:${gatewayAddress.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Accept: "text/event-stream",
        Authorization: "Bearer test-local-token"
      },
      body: JSON.stringify([
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
        { jsonrpc: "2.0", id: 2, method: "ping" }
      ])
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const rawBody = await response.text();
    const frames = rawBody.split("\n\n").filter((frame) => frame.length > 0);
    expect(frames.length).toBe(2);

    const events = frames.map((frame) => {
      const lines = frame.split("\n");
      expect(lines[0]).toBe("event: message");
      expect(lines[1]?.startsWith("data: ")).toBe(true);
      // Parsing each data payload independently proves it round-trips as a
      // single, complete JSON document that wasn't truncated or merged with
      // a neighboring event.
      return JSON.parse(lines[1]!.slice("data: ".length)) as { id: number; result?: unknown };
    });

    expect(events[0]?.id).toBe(1);
    const firstResult = events[0]?.result as { tools: Array<{ name: string }> };
    expect(firstResult.tools.map((tool) => tool.name)).toContain("echo");

    expect(events[1]?.id).toBe(2);
    expect(events[1]?.result).toEqual({ ok: true });
  });
});
