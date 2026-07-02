import http from "node:http";
import { URL } from "node:url";
import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
  type StdioServerParameters
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadMergedConfig } from "../core/config.js";
import { buildEnrichedPath } from "../core/spawn-env.js";
import { getOAuthAccessToken, isOAuthReference, oauthReferenceServerName } from "../core/oauth.js";
import { SecretsManager } from "../core/secrets.js";
import { UpstreamError, classifyUpstreamError, SecretNotFoundError } from "../core/errors.js";
import { APP_VERSION } from "../version.js";
import type {
  HttpServerSpec,
  JsonRpcRequest,
  JsonRpcResponse,
  McpxConfig,
  StdioServerSpec,
  UpstreamServerRuntime,
  UpstreamServerSpec,
  UpstreamTokenCount
} from "../types.js";
import { isServerEnabled } from "../types.js";

const JSON_RPC_VERSION = "2.0";
const SERVER_VERSION = APP_VERSION;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 60_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
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

interface UpstreamConnection {
  fingerprint: string;
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
}

interface UpstreamConnectionEntry {
  fingerprint: string;
  promise: Promise<UpstreamConnection>;
}

interface GatewayRuntimeState {
  upstreamConnections: Map<string, UpstreamConnectionEntry>;
  tokenCache?: Map<string, { fingerprint: string; count: UpstreamTokenCount }>;
  upstreamErrors?: Map<string, { code: string; message: string }>;
  lastWwwAuthenticate?: Map<string, string>;
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
  const all = Object.entries(config.servers)
    .filter(([, spec]) => isServerEnabled(spec))
    .map(([name, spec]) => ({ name, spec }));
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
    if (!selected || !isServerEnabled(selected) || selected.transport !== "http") {
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

/**
 * Checks if a server is OAuth-capable.
 * Only HTTP servers with Authorization headers (or similar) are considered OAuth-capable.
 * Stdio servers with env var auth are NOT OAuth-capable - they use internal auth.
 */
function isOAuthCapableServer(spec: UpstreamServerSpec): boolean {
  if (spec.transport !== "http") {
    return false;
  }

  // Check if the server has headers that suggest OAuth usage
  const headers = spec.headers ?? {};
  for (const headerName of Object.keys(headers)) {
    // Authorization header or any header with secret ref suggests OAuth/auth usage
    if (headerName.toLowerCase() === "authorization") {
      return true;
    }
  }

  return false;
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
  return callUpstreamOnce(upstream, method, params, secrets, runtime, passthroughAuthorizationHeader, false);
}

export async function getUpstreamTokenCounts(
  config: McpxConfig,
  secrets: SecretsManager,
  runtime: GatewayRuntimeState
): Promise<Record<string, UpstreamTokenCount>> {
  if (!runtime.tokenCache) {
    runtime.tokenCache = new Map<string, { fingerprint: string; count: UpstreamTokenCount }>();
  }

  const results: Record<string, UpstreamTokenCount> = {};
  const upstreams = listUpstreams(config);

  for (const upstream of upstreams) {
    const fingerprint = specFingerprint(upstream.spec);
    const cached = runtime.tokenCache.get(upstream.name);
    if (cached?.fingerprint === fingerprint) {
      const runtimeErr = runtime.upstreamErrors?.get(upstream.name);
      results[upstream.name] = runtimeErr
        ? { ...cached.count, runtimeError: runtimeErr.message, runtimeErrorCode: runtimeErr.code }
        : cached.count;
      continue;
    }

    let toolsCount = 0;
    let resourcesCount = 0;
    let promptsCount = 0;
    const errors: string[] = [];

    try {
      const toolsResult = await callUpstream(upstream, "tools/list", {}, "token-tools", secrets, runtime) as { tools?: Array<unknown> };
      if (toolsResult && toolsResult.tools) {
        toolsCount = Math.ceil(JSON.stringify(toolsResult.tools).length / 4);
      }
    } catch (error) {
      errors.push(`tools/list: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const resourcesResult = await callUpstream(upstream, "resources/list", {}, "token-resources", secrets, runtime) as { resources?: Array<unknown> };
      if (resourcesResult && resourcesResult.resources) {
        resourcesCount = Math.ceil(JSON.stringify(resourcesResult.resources).length / 4);
      }
    } catch (error) {
      errors.push(`resources/list: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const promptsResult = await callUpstream(upstream, "prompts/list", {}, "token-prompts", secrets, runtime) as { prompts?: Array<unknown> };
      if (promptsResult && promptsResult.prompts) {
        promptsCount = Math.ceil(JSON.stringify(promptsResult.prompts).length / 4);
      }
    } catch (error) {
      errors.push(`prompts/list: ${error instanceof Error ? error.message : String(error)}`);
    }

    const total = toolsCount + resourcesCount + promptsCount;
    const countObj: UpstreamTokenCount = {
      tools: toolsCount,
      resources: resourcesCount,
      prompts: promptsCount,
      total,
      error: errors.length > 0 ? errors.join("; ") : undefined
    };

    if (errors.length === 0) {
      runtime.tokenCache.set(upstream.name, { fingerprint, count: countObj });
    }
    const runtimeErr = runtime.upstreamErrors?.get(upstream.name);
    results[upstream.name] = runtimeErr ? { ...countObj, runtimeError: runtimeErr.message, runtimeErrorCode: runtimeErr.code } : countObj;
  }

  return results;
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

function resolveStdioEnv(spec: StdioServerSpec, secrets: SecretsManager): Record<string, string> {
  const env = getDefaultEnvironment();
  env.PATH = buildEnrichedPath(env.PATH);

  for (const [key, value] of Object.entries(spec.env ?? {})) {
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

async function buildHttpHeaders(
  upstream: UpstreamServerRuntime & { spec: HttpServerSpec },
  secrets: SecretsManager,
  options: { forceOAuthRefresh?: boolean; passthroughAuthorizationHeader?: string }
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(upstream.spec.headers ?? {})) {
    if (key.toLowerCase() === "authorization" && isOAuthReference(value)) {
      const oauthServerName = oauthReferenceServerName(value);
      const accessToken = await getOAuthAccessToken(oauthServerName, upstream.spec, secrets, {
        forceRefresh: options.forceOAuthRefresh
      });
      headers[key] = `Bearer ${accessToken}`;
    } else {
      headers[key] = secrets.resolveMaybeSecret(value);
    }
  }
  if (options.passthroughAuthorizationHeader) {
    headers.Authorization = options.passthroughAuthorizationHeader;
  }
  return headers;
}

async function closeUpstreamConnection(entry: UpstreamConnectionEntry): Promise<void> {
  try {
    const connection = await entry.promise;
    await connection.transport.close();
  } catch {
    // Ignore shutdown errors.
  }
}

async function reconcileUpstreamConnections(config: McpxConfig, runtime: GatewayRuntimeState): Promise<void> {
  const activeSpecs = new Map(
    Object.entries(config.servers)
      .filter(([, spec]) => isServerEnabled(spec))
      .map(([name, spec]) => [name, specFingerprint(spec)])
  );

  const staleKeys: string[] = [];
  for (const [key, entry] of runtime.upstreamConnections.entries()) {
    // Cache keys may have a ':passthrough' suffix; extract the upstream name before the first ':'
    const upstreamName = key.includes(":") ? key.slice(0, key.indexOf(":")) : key;
    const expectedFingerprint = activeSpecs.get(upstreamName);
    if (!expectedFingerprint || expectedFingerprint !== entry.fingerprint) {
      staleKeys.push(key);
    }
  }

  for (const key of staleKeys) {
    const entry = runtime.upstreamConnections.get(key);
    if (!entry) {
      continue;
    }
    runtime.upstreamConnections.delete(key);
    await closeUpstreamConnection(entry);
  }
}

function invalidateUpstreamConnection(
  upstreamName: string,
  passthroughAuthorizationHeader: string | undefined,
  runtime: GatewayRuntimeState
): void {
  const key = passthroughAuthorizationHeader ? `${upstreamName}:passthrough` : upstreamName;
  const existing = runtime.upstreamConnections.get(key);
  if (!existing) {
    return;
  }
  runtime.upstreamConnections.delete(key);
  void closeUpstreamConnection(existing);
}

async function getUpstreamConnection(
  upstream: UpstreamServerRuntime,
  secrets: SecretsManager,
  runtime: GatewayRuntimeState,
  options: { forceOAuthRefresh?: boolean; passthroughAuthorizationHeader?: string } = {}
): Promise<UpstreamConnection> {
  const { forceOAuthRefresh = false, passthroughAuthorizationHeader } = options;
  const cacheKey = passthroughAuthorizationHeader ? `${upstream.name}:passthrough` : upstream.name;
  const fingerprint = specFingerprint(upstream.spec);

  if (!forceOAuthRefresh) {
    const existing = runtime.upstreamConnections.get(cacheKey);
    if (existing) {
      if (existing.fingerprint === fingerprint) {
        return existing.promise;
      }
      runtime.upstreamConnections.delete(cacheKey);
      void closeUpstreamConnection(existing);
    }
  }

  const promise = (async (): Promise<UpstreamConnection> => {
    let transport: StdioClientTransport | StreamableHTTPClientTransport;

    if (upstream.spec.transport === "stdio") {
      transport = new StdioClientTransport(buildStdioServerParameters(upstream.spec as StdioServerSpec, secrets));
    } else {
      const headers = await buildHttpHeaders(
        upstream as UpstreamServerRuntime & { spec: HttpServerSpec },
        secrets,
        { forceOAuthRefresh, passthroughAuthorizationHeader }
      );
      const capturingFetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
        const response = await fetch(url, init);
        const wwwAuth = response.headers.get("www-authenticate");
        if (wwwAuth) {
          if (!runtime.lastWwwAuthenticate) {
            runtime.lastWwwAuthenticate = new Map();
          }
          runtime.lastWwwAuthenticate.set(upstream.name, wwwAuth);
        }
        return response;
      };
      transport = new StreamableHTTPClientTransport(
        new URL((upstream.spec as HttpServerSpec).url),
        { requestInit: { headers }, fetch: capturingFetch }
      );
    }

    const client = new Client({ name: "mcpx", version: SERVER_VERSION });
    await withTimeout(
      client.connect(transport),
      DEFAULT_CONNECT_TIMEOUT_MS,
      `Upstream ${upstream.name} failed to connect within ${DEFAULT_CONNECT_TIMEOUT_MS}ms.`
    );
    return { fingerprint, client, transport };
  })();

  runtime.upstreamConnections.set(cacheKey, { fingerprint, promise });

  try {
    return await promise;
  } catch (error) {
    runtime.upstreamConnections.delete(cacheKey);
    throw error;
  }
}

async function callUpstreamOnce(
  upstream: UpstreamServerRuntime,
  method: string,
  params: unknown,
  secrets: SecretsManager,
  runtime: GatewayRuntimeState,
  passthroughAuthorizationHeader: string | undefined,
  forceOAuthRefresh: boolean
): Promise<unknown> {
  const hasOAuth = upstream.spec.transport === "http"
    && Object.values((upstream.spec as HttpServerSpec).headers ?? {}).some(isOAuthReference);

  try {
    const connection = await getUpstreamConnection(upstream, secrets, runtime, {
      forceOAuthRefresh,
      passthroughAuthorizationHeader
    });

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

    throw new Error(`Unsupported method: ${method}`);
  } catch (error) {
    // Invalidate connection on any error so the next call reconnects cleanly.
    invalidateUpstreamConnection(upstream.name, passthroughAuthorizationHeader, runtime);

    // HTTP-specific: retry once with a refreshed OAuth token on 401/403.
    if (
      !forceOAuthRefresh
      && hasOAuth
      && error instanceof StreamableHTTPError
      && (error.code === 401 || error.code === 403)
    ) {
      return callUpstreamOnce(upstream, method, params, secrets, runtime, passthroughAuthorizationHeader, true);
    }

    // Classify all errors through the structured taxonomy.
    const wwwAuthenticate = runtime.lastWwwAuthenticate?.get(upstream.name);
    throw classifyUpstreamError(upstream.name, error, wwwAuthenticate);
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

function isAuthChallenge(error: unknown): error is UpstreamError {
  return error instanceof UpstreamError && (error.code === "auth_required" || error.code === "auth_expired");
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
      if (!runtime.tokenCache) {
        runtime.tokenCache = new Map();
      }
      const cached = runtime.tokenCache.get(upstream.name);
      const existing = cached?.fingerprint === specFingerprint(upstream.spec) ? cached.count : { tools: 0, resources: 0, prompts: 0, total: 0 };
      existing.tools = Math.ceil(JSON.stringify(result.tools ?? []).length / 4);
      existing.total = existing.tools + existing.resources + existing.prompts;
      delete existing.error;
      runtime.tokenCache.set(upstream.name, { fingerprint: specFingerprint(upstream.spec), count: existing });

      for (const tool of result.tools ?? []) {
        const name = typeof tool.name === "string" ? tool.name : "tool";
        tools.push({
          ...tool,
          name: flattenNames ? name : `${upstream.name}.${name}`
        });
      }
    } catch (error) {
      if (upstreams.length === 1) {
        throw error;
      }

      const code = error instanceof UpstreamError ? error.code : "upstream_error";
      runtime.upstreamErrors?.set(upstream.name, { code, message: error instanceof Error ? error.message : String(error) });
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
      if (!runtime.tokenCache) {
        runtime.tokenCache = new Map();
      }
      const cached = runtime.tokenCache.get(upstream.name);
      const existing = cached?.fingerprint === specFingerprint(upstream.spec) ? cached.count : { tools: 0, resources: 0, prompts: 0, total: 0 };
      existing.resources = Math.ceil(JSON.stringify(result.resources ?? []).length / 4);
      existing.total = existing.tools + existing.resources + existing.prompts;
      delete existing.error;
      runtime.tokenCache.set(upstream.name, { fingerprint: specFingerprint(upstream.spec), count: existing });

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
      if (upstreams.length === 1) {
        throw error;
      }

      const code = error instanceof UpstreamError ? error.code : "upstream_error";
      runtime.upstreamErrors?.set(upstream.name, { code, message: error instanceof Error ? error.message : String(error) });
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
      if (!runtime.tokenCache) {
        runtime.tokenCache = new Map();
      }
      const cached = runtime.tokenCache.get(upstream.name);
      const existing = cached?.fingerprint === specFingerprint(upstream.spec) ? cached.count : { tools: 0, resources: 0, prompts: 0, total: 0 };
      existing.prompts = Math.ceil(JSON.stringify(result.prompts ?? []).length / 4);
      existing.total = existing.tools + existing.resources + existing.prompts;
      delete existing.error;
      runtime.tokenCache.set(upstream.name, { fingerprint: specFingerprint(upstream.spec), count: existing });

      for (const prompt of result.prompts ?? []) {
        const name = typeof prompt.name === "string" ? prompt.name : "prompt";
        prompts.push({
          ...prompt,
          name: flattenNames ? name : `${upstream.name}.${name}`
        });
      }
    } catch (error) {
      if (upstreams.length === 1) {
        throw error;
      }

      const code = error instanceof UpstreamError ? error.code : "upstream_error";
      runtime.upstreamErrors?.set(upstream.name, { code, message: error instanceof Error ? error.message : String(error) });
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
      runtime.upstreamErrors?.delete(upstream.name);
      return makeResult(id, result);
    } catch (error) {
      if (isAuthChallenge(error)) {
        throw error;
      }
      const errCode = error instanceof UpstreamError ? error.code : "upstream_error";
      runtime.upstreamErrors?.set(upstream.name, { code: errCode, message: (error as Error).message });
      return makeError(id, -32000, (error as Error).message, { mcpxCode: errCode, upstream: upstream.name });
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
      runtime.upstreamErrors?.delete(upstream.name);
      return makeResult(id, result);
    } catch (error) {
      if (isAuthChallenge(error)) {
        throw error;
      }
      const errCode = error instanceof UpstreamError ? error.code : "upstream_error";
      runtime.upstreamErrors?.set(upstream.name, { code: errCode, message: (error as Error).message });
      return makeError(id, -32000, (error as Error).message, { mcpxCode: errCode, upstream: upstream.name });
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
    runtime.upstreamErrors?.delete(upstream.name);
    return makeResult(id, result);
  } catch (error) {
    if (isAuthChallenge(error)) {
      throw error;
    }
    const errCode = error instanceof UpstreamError ? error.code : "upstream_error";
    runtime.upstreamErrors?.set(upstream.name, { code: errCode, message: (error as Error).message });
    return makeError(id, -32000, (error as Error).message, { mcpxCode: errCode, upstream: upstream.name });
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

  const config = loadMergedConfig();
  if (upstreamFilter && listUpstreams(config, upstreamFilter).length === 0) {
    return makeError(id, -32602, `Unknown upstream: ${upstreamFilter}`);
  }
  await reconcileUpstreamConnections(config, runtime);

  if (request.method === "custom/tokenCounts") {
    const result = await getUpstreamTokenCounts(config, secrets, runtime);
    return makeResult(id, result);
  }

  if (request.method === "custom/refreshTokenCounts") {
    runtime.tokenCache?.clear();
    const result = await getUpstreamTokenCounts(config, secrets, runtime);
    return makeResult(id, result);
  }

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

  const config = loadMergedConfig();
  const requestedUpstream = getRequestedUpstream(requestUrl);
  const upstream = getScopedHttpUpstream(config, requestedUpstream);
  if (!upstream) {
    // No HTTP upstream found - this includes stdio servers which don't support OAuth
    response.statusCode = 404;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "not_found" }));
    return true;
  }

  // Check if this server is OAuth-capable
  // Stdio servers and HTTP servers without auth headers don't support OAuth
  if (!isOAuthCapableServer(upstream.spec)) {
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
    upstreamConnections: new Map(),
    upstreamErrors: new Map()
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
        if (body.length > 10_000_000) {
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
        response.end(JSON.stringify(makeError(null, -32001, "Upstream authentication required.", {
          mcpxCode: error.code,
          status: error.status,
          upstream: error.upstream
        })));
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
    for (const entry of runtime.upstreamConnections.values()) {
      void closeUpstreamConnection(entry);
    }
    runtime.upstreamConnections.clear();
  });

  server.listen(options.port, "127.0.0.1");
  return server;
}
