import http from "node:http";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createGatewayServer } from "../src/gateway/server.js";
import { defaultConfig, saveConfig } from "../src/core/config.js";
import { SecretsManager } from "../src/core/secrets.js";
import { setupTempEnv } from "./helpers.js";

interface StartedServer {
  server: http.Server;
  port: number;
}

async function startServer(handler: http.RequestListener): Promise<StartedServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
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
      if (payload.method === "tools/list") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { tools: [{ name: "echo", description: "Echo" }] } }));
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
      if (payload.method === "tools/list") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { tools: [{ name: "echo", description: "Echo" }] } }));
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

      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { id: string | number | null };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { tools: [{ name: "echo" }] } }));
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

      if (payload.method === "tools/list") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { tools: [{ name: "echo" }] } }));
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
      if (payload.method === "tools/call") {
        upstreamToolName = payload.params?.name ?? "";
      }

      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { ok: true } }));
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

    const payload = (await response.json()) as { result: { ok: boolean } };
    expect(payload.result.ok).toBe(true);
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
});
