import http from "node:http";
import { afterEach, expect, it } from "bun:test";
import { createGatewayServer } from "../src/gateway/server.js";
import { defaultConfig, saveConfig } from "../src/core/config.js";
import { SecretsManager } from "../src/core/secrets.js";
import { setupTempEnv } from "./helpers.js";
import { MCP_V2_PROTOCOL_VERSION, mcpV2Meta } from "../src/core/mcp-v2.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
const ui = { resourceUri: "ui://dashboard/index.html", visibility: ["model", "app"] };
const security = { csp: { connectDomains: ["https://api.example.test"] }, prefersBorder: true };

async function fixture(multiple: boolean) {
  const env = setupTempEnv("mcp-apps-"); cleanups.push(env.restore);
  const received: Array<any> = [];
  const upstream = http.createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const message = JSON.parse(raw); received.push(message);
    const result = message.method === "server/discover" ? { supportedVersions: [MCP_V2_PROTOCOL_VERSION], capabilities: { tools: {}, resources: {}, extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } } }
      : message.method === "tools/list" ? { tools: [{ name: "dashboard", inputSchema: { type: "object" }, _meta: { ui, custom: "keep" } }] }
      : message.method === "resources/list" ? { resources: [{ name: "Dashboard", uri: ui.resourceUri, mimeType: "text/html;profile=mcp-app", _meta: { ui: security } }] }
      : message.method === "resources/read" ? { contents: [{ uri: message.params.uri, mimeType: "text/html;profile=mcp-app", text: "<!doctype html><h1>App</h1>", _meta: { ui: security } }] }
      : message.params.arguments?.needsInput && !message.params.inputResponses ? { resultType: "input_required", requestState: "upstream-state", inputRequests: { approval: { method: "elicitation/create", params: { mode: "form", message: "Approve action", requestedSchema: { type: "object", properties: { approved: { type: "boolean" } } } } } } }
      : { content: [{ type: "text", text: message.params.name }], structuredContent: { ok: true }, _meta: { ui: { resourceUri: ui.resourceUri } } };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { resultType: "complete", ttlMs: 0, cacheScope: "private", ...result } }));
  });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>(resolve => upstream.close(() => resolve())));
  const upstreamPort = (upstream.address() as { port: number }).port;
  const config = defaultConfig();
  config.servers.alpha = { transport: "http", url: `http://127.0.0.1:${upstreamPort}/mcp` };
  if (multiple) config.servers.beta = { ...config.servers.alpha };
  saveConfig(config);
  const gateway = createGatewayServer({ port: 0, expectedToken: "admin", secrets: new SecretsManager() });
  if (!gateway.listening) await new Promise(resolve => gateway.once("listening", resolve));
  cleanups.push(() => new Promise<void>(resolve => gateway.close(() => resolve())));
  const port = (gateway.address() as { port: number }).port;
  const invoke = async (method: string, params: Record<string, unknown> = {}, scoped = false) => {
    const meta = { ...mcpV2Meta(), "io.modelcontextprotocol/clientCapabilities": { elicitation: { form: {} }, extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } } };
    const response = await fetch(`http://127.0.0.1:${port}/mcp${scoped ? "?upstream=alpha" : ""}`, { method: "POST", headers: { authorization: "Bearer admin", "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": MCP_V2_PROTOCOL_VERSION, "mcp-method": method, ...(params.name || params.uri ? { "mcp-name": String(params.name ?? params.uri) } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: meta } }) });
    return response.json() as Promise<any>;
  };
  return { invoke, received };
}

it("advertises Apps and preserves capabilities, resources, HTML security metadata, and callbacks on a scoped endpoint", async () => {
  const { invoke, received } = await fixture(true);
  expect((await invoke("server/discover", {}, true)).result.capabilities.extensions["io.modelcontextprotocol/ui"]).toBeDefined();
  const tools = await invoke("tools/list", {}, true);
  expect(tools.result.tools[0]._meta).toEqual({ ui, custom: "keep" });
  expect(received.find(request => request.method === "tools/list").params._meta["io.modelcontextprotocol/clientCapabilities"].extensions["io.modelcontextprotocol/ui"]).toBeDefined();
  const resource = await invoke("resources/read", { uri: ui.resourceUri }, true);
  expect(resource.result.contents[0]).toMatchObject({ uri: ui.resourceUri, mimeType: "text/html;profile=mcp-app", _meta: { ui: security } });
  expect((await invoke("tools/call", { name: "dashboard", arguments: {} }, true)).result.structuredContent).toEqual({ ok: true });
});

it("keeps the ui scheme and routes colliding UI resource names to their originating upstream", async () => {
  const { invoke, received } = await fixture(true);
  const tools = (await invoke("tools/list")).result.tools;
  expect(tools.map((tool: any) => tool.name)).toEqual(["alpha.dashboard", "beta.dashboard"]);
  const uris = tools.map((tool: any) => tool._meta.ui.resourceUri);
  expect(new Set(uris).size).toBe(2);
  expect(uris[0]).toStartWith("ui://");
  const resources = (await invoke("resources/list")).result.resources;
  expect(resources[0].uri).toBe(uris[0]);
  expect((await invoke("resources/read", { uri: uris[0] })).result.contents[0].uri).toBe(uris[0]);
  expect(received.filter(request => request.method === "resources/read").at(-1).params.uri).toBe(ui.resourceUri);
  expect((await invoke("resources/read", { uri: uris[1] }, true)).error.code).toBe(-32602);
});

it("relays MCP multi-round-trip results and restores state and input responses on retry", async () => {
  const { invoke, received } = await fixture(false);
  const first = await invoke("tools/call", { name: "dashboard", arguments: { needsInput: true } }, true);
  expect(first.result.resultType).toBe("input_required");
  expect(first.result.requestState).toBe("upstream-state");
  const inputResponses = { approval: { action: "accept", content: { approved: true } } };
  const second = await invoke("tools/call", { name: "dashboard", arguments: { needsInput: true }, requestState: first.result.requestState, inputResponses }, true);
  expect(second.result.structuredContent).toEqual({ ok: true });
  const retry = received.filter(request => request.method === "tools/call").at(-1);
  expect(retry.params.requestState).toBe("upstream-state");
  expect(retry.params.inputResponses).toEqual(inputResponses);
});
