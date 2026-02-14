import http from "node:http";
import { URL } from "node:url";
import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
  type StdioServerParameters
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadConfig } from "../core/config.js";
import { SecretsManager } from "../core/secrets.js";
import { APP_VERSION } from "../version.js";
import type {
  HttpServerSpec,
  JsonRpcRequest,
  JsonRpcResponse,
  McpxConfig,
  StdioServerSpec,
  UpstreamServerRuntime,
  UpstreamServerSpec
} from "../types.js";

const JSON_RPC_VERSION = "2.0";
const SERVER_VERSION = APP_VERSION;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 30_000;
const OAUTH_WELL_KNOWN_PREFIXES = [
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration"
];

interface GatewayServerOptions {
  port: number;
  expectedToken: string;
  secrets: SecretsManager;
}

interface StdioConnection {
  fingerprint: string;
  client: Client;
  transport: StdioClientTransport;
}

interface StdioConnectionEntry {
  fingerprint: string;
  promise: Promise<StdioConnection>;
}

interface GatewayRuntimeState {
  stdioConnections: Map<string, StdioConnectionEntry>;
}

class UpstreamHttpError extends Error {
  readonly status: number;
  readonly wwwAuthenticate?: string;
  readonly bodyText: string;

  constructor(upstreamName: string, status: number, bodyText: string, wwwAuthenticate?: string) {
    super(`Upstream ${upstreamName} returned HTTP ${status}: ${bodyText.slice(0, 400)}`);
    this.name = "UpstreamHttpError";
    this.status = status;
    this.bodyText = bodyText;
    this.wwwAuthenticate = wwwAuthenticate;
  }
}

function makeError(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      data
    }
  };
}

function makeResult(id: string | number | null, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

function listUpstreams(config: McpxConfig, upstreamFilter?: string): UpstreamServerRuntime[] {
  const all = Object.entries(config.servers).map(([name, spec]) => ({ name, spec }));
  if (!upstreamFilter) {
    return all;
  }

  return all.filter((upstream) => upstream.name === upstreamFilter);
}

function getSingleUpstream(config: McpxConfig): UpstreamServerRuntime | null {
  const upstreams = listUpstreams(config);
  if (upstreams.length !== 1) {
    return null;
  }

  return upstreams[0] ?? null;
}

function getSingleHttpUpstream(config: McpxConfig): (UpstreamServerRuntime & { spec: HttpServerSpec }) | null {
  const upstream = getSingleUpstream(config);
  if (!upstream || upstream.spec.transport !== "http") {
    return null;
  }

  return upstream as UpstreamServerRuntime & { spec: HttpServerSpec };
}

function getScopedHttpUpstream(
  config: McpxConfig,
  upstreamFilter?: string
): (UpstreamServerRuntime & { spec: HttpServerSpec }) | null {
  if (upstreamFilter) {
    const selected = config.servers[upstreamFilter];
    if (!selected || selected.transport !== "http") {
      return null;
    }

    return {
      name: upstreamFilter,
      spec: selected
    };
  }

  return getSingleHttpUpstream(config);
}

function getWellKnownPrefix(pathname: string): string | null {
  for (const prefix of OAUTH_WELL_KNOWN_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return prefix;
    }
  }

  return null;
}

function getUpstreamPathSuffixForWellKnown(upstream: UpstreamServerRuntime & { spec: HttpServerSpec }): string {
  const upstreamUrl = new URL(upstream.spec.url);
  if (upstreamUrl.pathname === "/") {
    return "";
  }

  return upstreamUrl.pathname.endsWith("/")
    ? upstreamUrl.pathname.slice(0, -1)
    : upstreamUrl.pathname;
}

function buildWellKnownUpstreamUrl(upstream: UpstreamServerRuntime & { spec: HttpServerSpec }, prefix: string): URL {
  const upstreamUrl = new URL(upstream.spec.url);
  const suffix = getUpstreamPathSuffixForWellKnown(upstream);
  return new URL(`${prefix}${suffix}`, upstreamUrl.origin);
}

function getLocalOriginFromRequest(request: http.IncomingMessage): string {
  return `http://${request.headers.host ?? "127.0.0.1"}`;
}

function getRequestedUpstream(requestUrl: URL): string | undefined {
  const value = requestUrl.searchParams.get("upstream");
  if (!value) {
    return undefined;
  }

  return value.trim() || undefined;
}

function appendUpstreamQuery(url: string, upstream?: string): string {
  if (!upstream) {
    return url;
  }

  const parsed = new URL(url);
  parsed.searchParams.set("upstream", upstream);
  return parsed.toString();
}

function rewriteWwwAuthenticateResourceMetadata(headerValue: string, localResourceMetadataUrl: string): string {
  if (headerValue.includes("resource_metadata=")) {
    return headerValue.replace(/resource_metadata="[^"]*"/, `resource_metadata="${localResourceMetadataUrl}"`);
  }

  return `${headerValue}, resource_metadata="${localResourceMetadataUrl}"`;
}

function splitNamespacedName(value: string): { serverName: string; upstreamName: string } | null {
  const split = value.indexOf(".");
  if (split <= 0 || split >= value.length - 1) {
    return null;
  }

  return {
    serverName: value.slice(0, split),
    upstreamName: value.slice(split + 1)
  };
}

function parseNamespacedUri(uri: string): { serverName: string; upstreamUri: string } | null {
  if (uri.startsWith("mcpx://")) {
    const rest = uri.slice("mcpx://".length);
    const slashIndex = rest.indexOf("/");
    if (slashIndex <= 0 || slashIndex >= rest.length - 1) {
      return null;
    }

    const serverName = rest.slice(0, slashIndex);
    const encoded = rest.slice(slashIndex + 1);
    try {
      return {
        serverName,
        upstreamUri: decodeURIComponent(encoded)
      };
    } catch {
      return null;
    }
  }

  const nameSplit = splitNamespacedName(uri);
  if (!nameSplit) {
    return null;
  }

  return {
    serverName: nameSplit.serverName,
    upstreamUri: nameSplit.upstreamName
  };
}

async function callUpstream(
  upstream: UpstreamServerRuntime,
  method: string,
  params: unknown,
  id: string | number | null,
  secrets: SecretsManager,
  runtime: GatewayRuntimeState,
  passthroughAuthorizationHeader?: string
): Promise<unknown> {
  if (upstream.spec.transport === "stdio") {
    return callStdioUpstream(upstream as UpstreamServerRuntime & { spec: StdioServerSpec }, method, params, secrets, runtime);
  }

  return callHttpUpstream(
    upstream as UpstreamServerRuntime & { spec: HttpServerSpec },
    method,
    params,
    id,
    secrets,
    passthroughAuthorizationHeader
  );
}

function getConfiguredTimeoutMs(): number {
  const configuredTimeout = Number(process.env.MCPX_UPSTREAM_TIMEOUT_MS ?? DEFAULT_UPSTREAM_TIMEOUT_MS);
  return Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : DEFAULT_UPSTREAM_TIMEOUT_MS;
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);

    void work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function specFingerprint(spec: UpstreamServerSpec): string {
  return JSON.stringify(spec);
}

function resolveStdioEnv(spec: StdioServerSpec, secrets: SecretsManager): Record<string, string> | undefined {
  if (!spec.env || Object.keys(spec.env).length === 0) {
    return undefined;
  }

  const env = getDefaultEnvironment();
  for (const [key, value] of Object.entries(spec.env)) {
    env[key] = secrets.resolveMaybeSecret(value);
  }

  return env;
}

function buildStdioServerParameters(spec: StdioServerSpec, secrets: SecretsManager): StdioServerParameters {
  return {
    command: spec.command,
    args: spec.args ?? [],
    cwd: spec.cwd,
    env: resolveStdioEnv(spec, secrets)
  };
}

async function closeStdioConnection(entry: StdioConnectionEntry): Promise<void> {
  try {
    const connection = await entry.promise;
    await connection.transport.close();
  } catch {
    // Ignore shutdown errors.
  }
}

async function reconcileStdioConnections(config: McpxConfig, runtime: GatewayRuntimeState): Promise<void> {
  const activeSpecs = new Map(
    Object.entries(config.servers).map(([name, spec]) => [name, specFingerprint(spec)])
  );

  const staleNames: string[] = [];
  for (const [name, entry] of runtime.stdioConnections.entries()) {
    const expectedFingerprint = activeSpecs.get(name);
    if (!expectedFingerprint || expectedFingerprint !== entry.fingerprint) {
      staleNames.push(name);
    }
  }

  for (const name of staleNames) {
    const entry = runtime.stdioConnections.get(name);
    if (!entry) {
      continue;
    }

    runtime.stdioConnections.delete(name);
    await closeStdioConnection(entry);
  }
}

function invalidateStdioConnection(name: string, runtime: GatewayRuntimeState): void {
  const existing = runtime.stdioConnections.get(name);
  if (!existing) {
    return;
  }

  runtime.stdioConnections.delete(name);
  void closeStdioConnection(existing);
}

async function getStdioConnection(
  upstream: UpstreamServerRuntime & { spec: StdioServerSpec },
  secrets: SecretsManager,
  runtime: GatewayRuntimeState
): Promise<StdioConnection> {
  const fingerprint = specFingerprint(upstream.spec);
  const existing = runtime.stdioConnections.get(upstream.name);
  if (existing) {
    if (existing.fingerprint === fingerprint) {
      return existing.promise;
    }

    runtime.stdioConnections.delete(upstream.name);
    void closeStdioConnection(existing);
  }

  const promise = (async (): Promise<StdioConnection> => {
    const transport = new StdioClientTransport(buildStdioServerParameters(upstream.spec, secrets));
    const client = new Client({
      name: "mcpx",
      version: SERVER_VERSION
    });
    await client.connect(transport);
    return {
      fingerprint,
      client,
      transport
    };
  })();

  runtime.stdioConnections.set(upstream.name, {
    fingerprint,
    promise
  });

  try {
    return await promise;
  } catch (error) {
    runtime.stdioConnections.delete(upstream.name);
    throw error;
  }
}

async function callStdioUpstream(
  upstream: UpstreamServerRuntime & { spec: StdioServerSpec },
  method: string,
  params: unknown,
  secrets: SecretsManager,
  runtime: GatewayRuntimeState
): Promise<unknown> {
  try {
    const connection = await getStdioConnection(upstream, secrets, runtime);
    const timeoutMs = getConfiguredTimeoutMs();
    const timeoutMessage = `Upstream ${upstream.name} timed out after ${timeoutMs}ms for method ${method}.`;

    if (method === "tools/list") {
      return withTimeout(connection.client.listTools(params as never), timeoutMs, timeoutMessage);
    }

    if (method === "resources/list") {
      return withTimeout(connection.client.listResources(params as never), timeoutMs, timeoutMessage);
    }

    if (method === "prompts/list") {
      return withTimeout(connection.client.listPrompts(params as never), timeoutMs, timeoutMessage);
    }

    if (method === "tools/call") {
      return withTimeout(connection.client.callTool(params as never), timeoutMs, timeoutMessage);
    }

    if (method === "resources/read") {
      return withTimeout(connection.client.readResource(params as never), timeoutMs, timeoutMessage);
    }

    if (method === "prompts/get") {
      return withTimeout(connection.client.getPrompt(params as never), timeoutMs, timeoutMessage);
    }

    throw new Error(`Unsupported stdio passthrough method: ${method}`);
  } catch (error) {
    invalidateStdioConnection(upstream.name, runtime);
    throw error;
  }
}

async function callHttpUpstream(
  upstream: UpstreamServerRuntime & { spec: HttpServerSpec },
  method: string,
  params: unknown,
  id: string | number | null,
  secrets: SecretsManager,
  passthroughAuthorizationHeader?: string
): Promise<unknown> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream"
  };

  for (const [key, value] of Object.entries(upstream.spec.headers ?? {})) {
    headers[key] = secrets.resolveMaybeSecret(value);
  }

  if (passthroughAuthorizationHeader) {
    headers.Authorization = passthroughAuthorizationHeader;
  }

  const timeoutMs = getConfiguredTimeoutMs();
  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(() => timeoutController.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(upstream.spec.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: JSON_RPC_VERSION,
        id,
        method,
        params
      }),
      signal: timeoutController.signal
    });
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "AbortError") {
      throw new Error(`Upstream ${upstream.name} timed out after ${timeoutMs}ms for method ${method}.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!response.ok) {
    const responseText = await response.text();
    throw new UpstreamHttpError(
      upstream.name,
      response.status,
      responseText,
      response.headers.get("www-authenticate") ?? undefined
    );
  }

  let payload: JsonRpcResponse | null = null;
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    payload = JSON.parse(await response.text()) as JsonRpcResponse;
  } else if (contentType.includes("text/event-stream")) {
    payload = await readSseJsonRpcResponse(response, id);
  } else {
    try {
      payload = JSON.parse(await response.text()) as JsonRpcResponse;
    } catch {
      payload = null;
    }
  }

  if (!payload) {
    throw new Error(`Upstream ${upstream.name} response could not be parsed as JSON-RPC payload.`);
  }

  if (payload.error) {
    throw new Error(`Upstream ${upstream.name} error: ${payload.error.message}`);
  }

  return payload.result;
}

async function readSseJsonRpcResponse(response: Response, expectedId: string | number | null): Promise<JsonRpcResponse | null> {
  if (!response.body) {
    return null;
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  let dataLines: string[] = [];
  let latestPayload: JsonRpcResponse | null = null;

  const consumeEvent = (): JsonRpcResponse | null => {
    if (dataLines.length === 0) {
      return null;
    }

    const combined = dataLines.join("\n").trim();
    dataLines = [];

    if (!combined || combined === "[DONE]") {
      return null;
    }

    try {
      const parsed = JSON.parse(combined) as JsonRpcResponse;
      latestPayload = parsed;

      const parsedId = parsed.id ?? null;
      if (parsedId === expectedId) {
        return parsed;
      }

      return null;
    } catch {
      return null;
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex < 0) {
          break;
        }

        let line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        if (line.endsWith("\r")) {
          line = line.slice(0, -1);
        }

        if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trimStart());
          continue;
        }

        if (line === "") {
          const matched = consumeEvent();
          if (matched) {
            return matched;
          }
        }
      }
    }

    buffer += decoder.decode();
    if (buffer.length > 0) {
      let finalLine = buffer;
      if (finalLine.endsWith("\r")) {
        finalLine = finalLine.slice(0, -1);
      }

      if (finalLine.startsWith("data:")) {
        dataLines.push(finalLine.slice("data:".length).trimStart());
      }
    }

    return consumeEvent() ?? latestPayload;
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Ignore reader cancellation issues.
    }
  }
}

function authHeaderIsValid(request: http.IncomingMessage, expectedToken: string): boolean {
  const localTokenHeader = request.headers["x-mcpx-local-token"];
  if (typeof localTokenHeader === "string" && localTokenHeader === expectedToken) {
    return true;
  }
  if (Array.isArray(localTokenHeader) && localTokenHeader.includes(expectedToken)) {
    return true;
  }

  const authHeader = request.headers.authorization;
  if (!authHeader) {
    return false;
  }

  const [scheme, token] = authHeader.split(" ");
  return scheme === "Bearer" && token === expectedToken;
}

function isAuthChallenge(error: unknown): error is UpstreamHttpError {
  return error instanceof UpstreamHttpError && (error.status === 401 || error.status === 403);
}

function getClientAuthorizationForUpstream(request: http.IncomingMessage, expectedToken: string): string | undefined {
  const authHeader = request.headers.authorization;
  if (!authHeader) {
    return undefined;
  }

  const [scheme, token] = authHeader.split(" ");
  if (scheme === "Bearer" && token === expectedToken) {
    // Legacy local auth mode: Authorization is the local token, not an upstream OAuth token.
    return undefined;
  }

  return authHeader;
}

async function handleListTools(
  config: McpxConfig,
  secrets: SecretsManager,
  runtime: GatewayRuntimeState,
  upstreamFilter?: string,
  clientAuthorizationHeader?: string
): Promise<unknown> {
  const tools: Record<string, unknown>[] = [];
  const flattenedUpstream = listUpstreams(config, upstreamFilter).length === 1;
  const flattenNames = Boolean(flattenedUpstream);
  const upstreams = listUpstreams(config, upstreamFilter);

  for (const upstream of upstreams) {
    try {
      const result = (await callUpstream(
        upstream,
        "tools/list",
        {},
        `list-tools-${upstream.name}`,
        secrets,
        runtime,
        clientAuthorizationHeader
      )) as { tools?: Array<Record<string, unknown>> };
      for (const tool of result.tools ?? []) {
        const name = typeof tool.name === "string" ? tool.name : "tool";
        tools.push({
          ...tool,
          name: flattenNames ? name : `${upstream.name}.${name}`
        });
      }
    } catch (error) {
      if (upstreams.length === 1 && isAuthChallenge(error)) {
        throw error;
      }

      // Upstream errors are isolated so one failed server does not break catalog.
    }
  }

  return { tools };
}

async function handleListResources(
  config: McpxConfig,
  secrets: SecretsManager,
  runtime: GatewayRuntimeState,
  upstreamFilter?: string,
  clientAuthorizationHeader?: string
): Promise<unknown> {
  const resources: Record<string, unknown>[] = [];
  const flattenedUpstream = listUpstreams(config, upstreamFilter).length === 1;
  const flattenNames = Boolean(flattenedUpstream);
  const upstreams = listUpstreams(config, upstreamFilter);

  for (const upstream of upstreams) {
    try {
      const result = (await callUpstream(
        upstream,
        "resources/list",
        {},
        `list-resources-${upstream.name}`,
        secrets,
        runtime,
        clientAuthorizationHeader
      )) as {
        resources?: Array<Record<string, unknown>>;
      };

      for (const resource of result.resources ?? []) {
        const originalUri = typeof resource.uri === "string" ? resource.uri : "";
        const originalName = typeof resource.name === "string" ? resource.name : originalUri;
        resources.push({
          ...resource,
          name: flattenNames ? originalName : `${upstream.name}.${originalName}`,
          uri: flattenNames ? originalUri : `mcpx://${upstream.name}/${encodeURIComponent(originalUri)}`
        });
      }
    } catch (error) {
      if (upstreams.length === 1 && isAuthChallenge(error)) {
        throw error;
      }

      // Upstream errors are isolated so one failed server does not break catalog.
    }
  }

  return { resources };
}

async function handleListPrompts(
  config: McpxConfig,
  secrets: SecretsManager,
  runtime: GatewayRuntimeState,
  upstreamFilter?: string,
  clientAuthorizationHeader?: string
): Promise<unknown> {
  const prompts: Record<string, unknown>[] = [];
  const flattenedUpstream = listUpstreams(config, upstreamFilter).length === 1;
  const flattenNames = Boolean(flattenedUpstream);
  const upstreams = listUpstreams(config, upstreamFilter);

  for (const upstream of upstreams) {
    try {
      const result = (await callUpstream(
        upstream,
        "prompts/list",
        {},
        `list-prompts-${upstream.name}`,
        secrets,
        runtime,
        clientAuthorizationHeader
      )) as {
        prompts?: Array<Record<string, unknown>>;
      };

      for (const prompt of result.prompts ?? []) {
        const name = typeof prompt.name === "string" ? prompt.name : "prompt";
        prompts.push({
          ...prompt,
          name: flattenNames ? name : `${upstream.name}.${name}`
        });
      }
    } catch (error) {
      if (upstreams.length === 1 && isAuthChallenge(error)) {
        throw error;
      }

      // Upstream errors are isolated so one failed server does not break catalog.
    }
  }

  return { prompts };
}

async function routeNamespacedCall(
  config: McpxConfig,
  method: "tools/call" | "resources/read" | "prompts/get",
  params: Record<string, unknown> | undefined,
  id: string | number | null,
  secrets: SecretsManager,
  runtime: GatewayRuntimeState,
  upstreamFilter?: string,
  clientAuthorizationHeader?: string
): Promise<JsonRpcResponse> {
  if (!params || typeof params !== "object") {
    return makeError(id, -32602, "Missing params object.");
  }

  const upstreamEntries = listUpstreams(config, upstreamFilter);
  const upstreams = new Map(upstreamEntries.map((entry) => [entry.name, entry]));
  const flattenedUpstream = upstreamEntries.length === 1 ? upstreamEntries[0] : null;

  if (method === "tools/call") {
    const toolName = typeof params.name === "string" ? params.name : "";
    const split = splitNamespacedName(toolName);
    if (split && upstreamFilter && split.serverName !== upstreamFilter) {
      return makeError(id, -32602, `Tool belongs to upstream ${split.serverName}, but request is scoped to ${upstreamFilter}.`);
    }
    let upstream: UpstreamServerRuntime | undefined;
    let upstreamToolName = toolName;
    if (split && upstreams.has(split.serverName)) {
      upstream = upstreams.get(split.serverName);
      upstreamToolName = split.upstreamName;
    } else if (flattenedUpstream) {
      upstream = flattenedUpstream;
    }

    if (!upstream) {
      return makeError(id, -32602, "Tool name must be namespaced as <server>.<tool>.");
    }

    const upstreamParams = {
      ...params,
      name: upstreamToolName
    };

    try {
      const result = await callUpstream(upstream, method, upstreamParams, id, secrets, runtime, clientAuthorizationHeader);
      return makeResult(id, result);
    } catch (error) {
      if (isAuthChallenge(error)) {
        throw error;
      }
      return makeError(id, -32000, (error as Error).message);
    }
  }

  if (method === "prompts/get") {
    const promptName = typeof params.name === "string" ? params.name : "";
    const split = splitNamespacedName(promptName);
    if (split && upstreamFilter && split.serverName !== upstreamFilter) {
      return makeError(id, -32602, `Prompt belongs to upstream ${split.serverName}, but request is scoped to ${upstreamFilter}.`);
    }
    let upstream: UpstreamServerRuntime | undefined;
    let upstreamPromptName = promptName;
    if (split && upstreams.has(split.serverName)) {
      upstream = upstreams.get(split.serverName);
      upstreamPromptName = split.upstreamName;
    } else if (flattenedUpstream) {
      upstream = flattenedUpstream;
    }

    if (!upstream) {
      return makeError(id, -32602, "Prompt name must be namespaced as <server>.<prompt>.");
    }

    const upstreamParams = {
      ...params,
      name: upstreamPromptName
    };

    try {
      const result = await callUpstream(upstream, method, upstreamParams, id, secrets, runtime, clientAuthorizationHeader);
      return makeResult(id, result);
    } catch (error) {
      if (isAuthChallenge(error)) {
        throw error;
      }
      return makeError(id, -32000, (error as Error).message);
    }
  }

  const uri = typeof params.uri === "string" ? params.uri : "";
  const parsed = parseNamespacedUri(uri);
  if (parsed && upstreamFilter && parsed.serverName !== upstreamFilter) {
    return makeError(id, -32602, `Resource belongs to upstream ${parsed.serverName}, but request is scoped to ${upstreamFilter}.`);
  }
  let upstream: UpstreamServerRuntime | undefined;
  let upstreamUri = uri;
  if (parsed && upstreams.has(parsed.serverName)) {
    upstream = upstreams.get(parsed.serverName);
    upstreamUri = parsed.upstreamUri;
  } else if (flattenedUpstream) {
    upstream = flattenedUpstream;
  }

  if (!upstream) {
    return makeError(id, -32602, "Resource URI must be namespaced (mcpx://<server>/<encoded-uri>).", { uri });
  }

  const upstreamParams = {
    ...params,
    uri: upstreamUri
  };

  try {
    const result = await callUpstream(upstream, method, upstreamParams, id, secrets, runtime, clientAuthorizationHeader);
    return makeResult(id, result);
  } catch (error) {
    if (isAuthChallenge(error)) {
      throw error;
    }
    return makeError(id, -32000, (error as Error).message);
  }
}

async function handleRequestObject(
  request: JsonRpcRequest,
  secrets: SecretsManager,
  runtime: GatewayRuntimeState,
  upstreamFilter?: string,
  clientAuthorizationHeader?: string
): Promise<JsonRpcResponse | null> {
  const id = request.id ?? null;

  if (!request.method || typeof request.method !== "string") {
    return makeError(id, -32600, "Invalid JSON-RPC request: missing method.");
  }

  if (request.method === "initialize") {
    const requestedProtocol = (request.params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
    const protocolVersion = typeof requestedProtocol === "string" && requestedProtocol.length > 0
      ? requestedProtocol
      : "2025-11-25";

    return makeResult(id, {
      protocolVersion,
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      },
      serverInfo: {
        name: "mcpx",
        version: SERVER_VERSION
      }
    });
  }

  if (request.method === "notifications/initialized") {
    return null;
  }

  if (request.method === "ping") {
    return makeResult(id, { ok: true });
  }

  const config = loadConfig();
  if (upstreamFilter && !config.servers[upstreamFilter]) {
    return makeError(id, -32602, `Unknown upstream: ${upstreamFilter}`);
  }
  await reconcileStdioConnections(config, runtime);

  if (request.method === "tools/list") {
    const result = await handleListTools(config, secrets, runtime, upstreamFilter, clientAuthorizationHeader);
    return makeResult(id, result);
  }

  if (request.method === "resources/list") {
    const result = await handleListResources(config, secrets, runtime, upstreamFilter, clientAuthorizationHeader);
    return makeResult(id, result);
  }

  if (request.method === "prompts/list") {
    const result = await handleListPrompts(config, secrets, runtime, upstreamFilter, clientAuthorizationHeader);
    return makeResult(id, result);
  }

  if (request.method === "tools/call" || request.method === "resources/read" || request.method === "prompts/get") {
    return routeNamespacedCall(
      config,
      request.method,
      request.params as Record<string, unknown> | undefined,
      id,
      secrets,
      runtime,
      upstreamFilter,
      clientAuthorizationHeader
    );
  }

  return makeError(id, -32601, `Unsupported method: ${request.method}`);
}

async function maybeHandleWellKnownOAuthRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  requestUrl: URL,
  secrets: SecretsManager
): Promise<boolean> {
  const pathname = requestUrl.pathname;
  const wellKnownPrefix = getWellKnownPrefix(pathname);
  if (!wellKnownPrefix) {
    return false;
  }

  if (request.method !== "GET") {
    response.statusCode = 405;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "method_not_allowed" }));
    return true;
  }

  const config = loadConfig();
  const requestedUpstream = getRequestedUpstream(requestUrl);
  const upstream = getScopedHttpUpstream(config, requestedUpstream);
  if (!upstream) {
    response.statusCode = 404;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "not_found" }));
    return true;
  }

  const upstreamWellKnownUrl = buildWellKnownUpstreamUrl(upstream, wellKnownPrefix);
  const headers: Record<string, string> = {
    accept: "application/json"
  };

  const protocolVersion = request.headers["mcp-protocol-version"];
  if (typeof protocolVersion === "string" && protocolVersion.length > 0) {
    headers["mcp-protocol-version"] = protocolVersion;
  }

  for (const [key, value] of Object.entries(upstream.spec.headers ?? {})) {
    headers[key] = secrets.resolveMaybeSecret(value);
  }

  const upstreamResponse = await fetch(upstreamWellKnownUrl, {
    method: "GET",
    headers
  });
  let bodyText = await upstreamResponse.text();
  response.statusCode = upstreamResponse.status;

  const contentType = upstreamResponse.headers.get("content-type");
  if (contentType) {
    response.setHeader("content-type", contentType);
  }

  const cacheControl = upstreamResponse.headers.get("cache-control");
  if (cacheControl) {
    response.setHeader("cache-control", cacheControl);
  }

  const wwwAuthenticate = upstreamResponse.headers.get("www-authenticate");
  if (wwwAuthenticate) {
    response.setHeader("www-authenticate", wwwAuthenticate);
  }

  if (
    wellKnownPrefix === "/.well-known/oauth-protected-resource"
    && contentType?.includes("application/json")
    && upstreamResponse.ok
  ) {
    try {
      const parsed = JSON.parse(bodyText) as Record<string, unknown>;
      parsed.resource = appendUpstreamQuery(`${getLocalOriginFromRequest(request)}/mcp`, requestedUpstream);
      bodyText = JSON.stringify(parsed);
    } catch {
      // Keep original body if parsing fails.
    }
  }

  response.end(bodyText);
  return true;
}

export function createGatewayServer(options: GatewayServerOptions): http.Server {
  const debug = process.env.MCPX_GATEWAY_DEBUG === "1";
  const runtime: GatewayRuntimeState = {
    stdioConnections: new Map()
  };

  const server = http.createServer(async (request, response) => {
    let requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    try {
      requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
      const upstreamFilter = getRequestedUpstream(requestUrl);
      if (debug) {
        console.error(`[mcpx gateway] ${request.method ?? "?"} ${requestUrl.pathname} auth=${request.headers.authorization ? "yes" : "no"} accept=${request.headers.accept ?? ""}`);
        console.error(`[mcpx gateway] headers=${JSON.stringify(request.headers)}`);
      }

      if (await maybeHandleWellKnownOAuthRequest(request, response, requestUrl, options.secrets)) {
        if (debug) {
          console.error(`[mcpx gateway] -> ${response.statusCode} (well-known oauth)`);
        }
        return;
      }

      if (requestUrl.pathname !== "/mcp") {
        response.statusCode = 404;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ error: "not_found" }));
        if (debug) {
          console.error(`[mcpx gateway] -> 404`);
        }
        return;
      }

      if (request.method === "GET") {
        if (!authHeaderIsValid(request, options.expectedToken)) {
          response.statusCode = 401;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify(makeError(null, -32001, "Unauthorized")));
          if (debug) {
            console.error(`[mcpx gateway] -> 401 (GET unauthorized)`);
          }
          return;
        }

        response.statusCode = 200;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ ok: true, server: "mcpx" }));
        if (debug) {
          console.error(`[mcpx gateway] -> 200 (GET ok)`);
        }
        return;
      }

      if (request.method !== "POST") {
        response.statusCode = 405;
        response.end("Method Not Allowed");
        if (debug) {
          console.error(`[mcpx gateway] -> 405`);
        }
        return;
      }

      if (!authHeaderIsValid(request, options.expectedToken)) {
        response.statusCode = 401;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(makeError(null, -32001, "Unauthorized")));
        if (debug) {
          console.error(`[mcpx gateway] -> 401 (POST unauthorized)`);
        }
        return;
      }

      let body = "";
      request.setEncoding("utf8");

      for await (const chunk of request) {
        body += chunk;
        if (body.length > 2_000_000) {
          response.statusCode = 413;
          response.end("Payload Too Large");
          if (debug) {
            console.error(`[mcpx gateway] -> 413`);
          }
          return;
        }
      }

      const parsed = JSON.parse(body) as JsonRpcRequest | JsonRpcRequest[];
      const hasInitialize = Array.isArray(parsed)
        ? parsed.some((item) => item.method === "initialize")
        : parsed.method === "initialize";
      const responses: JsonRpcResponse[] = [];
      const clientAuthorizationHeader = getClientAuthorizationForUpstream(request, options.expectedToken);

      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (debug) {
            console.error(`[mcpx gateway] rpc method=${item.method} id=${item.id ?? "null"}`);
          }
          const rpcResponse = await handleRequestObject(item, options.secrets, runtime, upstreamFilter, clientAuthorizationHeader);
          if (debug && rpcResponse?.error) {
            console.error(`[mcpx gateway] rpc error code=${rpcResponse.error.code} message=${rpcResponse.error.message}`);
          }
          if (rpcResponse) {
            responses.push(rpcResponse);
          }
        }
      } else {
        if (debug) {
          console.error(`[mcpx gateway] rpc method=${parsed.method} id=${parsed.id ?? "null"}`);
          if (parsed.method === "initialize") {
            console.error(`[mcpx gateway] rpc initialize params=${JSON.stringify(parsed.params ?? {})}`);
          }
        }
        const rpcResponse = await handleRequestObject(parsed, options.secrets, runtime, upstreamFilter, clientAuthorizationHeader);
        if (debug && rpcResponse?.error) {
          console.error(`[mcpx gateway] rpc error code=${rpcResponse.error.code} message=${rpcResponse.error.message}`);
        }
        if (rpcResponse) {
          responses.push(rpcResponse);
        }
      }

      response.statusCode = 200;
      const acceptsSse = (request.headers.accept ?? "").includes("text/event-stream");
      if (acceptsSse) {
        response.setHeader("content-type", "text/event-stream");
        response.setHeader("cache-control", "no-cache");
        response.setHeader("connection", "keep-alive");
      } else {
        response.setHeader("content-type", "application/json");
      }
      if (hasInitialize) {
        const sessionId = crypto.randomUUID();
        response.setHeader("mcp-session-id", sessionId);
        response.setHeader("MCP-Session-Id", sessionId);
      }
      if (debug) {
        console.error(`[mcpx gateway] -> 200 (rpc)`);
      }

      if (acceptsSse) {
        const payloads = responses.length > 0 ? responses : [];
        for (const payload of payloads) {
          response.write(`event: message\n`);
          response.write(`data: ${JSON.stringify(payload)}\n\n`);
        }
        response.end();
      } else if (responses.length === 1) {
        response.end(JSON.stringify(responses[0]));
      } else {
        response.end(JSON.stringify(responses));
      }
    } catch (error) {
      if (isAuthChallenge(error)) {
        response.statusCode = error.status;
        response.setHeader("content-type", "application/json");
        if (error.wwwAuthenticate) {
          const localResourceMetadataUrl = appendUpstreamQuery(
            `${getLocalOriginFromRequest(request)}/.well-known/oauth-protected-resource`,
            getRequestedUpstream(requestUrl)
          );
          response.setHeader("www-authenticate", rewriteWwwAuthenticateResourceMetadata(error.wwwAuthenticate, localResourceMetadataUrl));
        }
        response.end(error.bodyText.length > 0 ? error.bodyText : JSON.stringify({ error: "upstream_auth_required" }));
        if (debug) {
          console.error(`[mcpx gateway] -> ${error.status} upstream auth challenge`);
        }
        return;
      }

      response.statusCode = 500;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(makeError(null, -32000, (error as Error).message)));
      if (debug) {
        console.error(`[mcpx gateway] -> 500 ${(error as Error).message}`);
      }
    }
  });

  server.on("close", () => {
    for (const entry of runtime.stdioConnections.values()) {
      void closeStdioConnection(entry);
    }
    runtime.stdioConnections.clear();
  });

  server.listen(options.port, "127.0.0.1");
  return server;
}
