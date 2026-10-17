import http from "node:http";
import { URL } from "node:url";
import crypto from "node:crypto";
import { Client, SdkHttpError } from "@modelcontextprotocol/client";
import {
  StdioClientTransport,
  getDefaultEnvironment,
  type StdioServerParameters
} from "@modelcontextprotocol/client/stdio";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler, ProtocolError, Server } from "@modelcontextprotocol/server";
import { toWebRequest } from "@modelcontextprotocol/node";
import { MCP_V2_PROTOCOL_VERSION } from "../core/mcp-v2.js";
import { loadMergedConfig } from "../core/config.js";
import { buildEnrichedPath } from "../core/spawn-env.js";
import { getOAuthAccessToken, isOAuthReference, oauthReferenceServerName, oauthSecretNames } from "../core/oauth.js";
import { SecretsManager } from "../core/secrets.js";
import { UpstreamError, classifyUpstreamError, SecretNotFoundError, type UpstreamErrorCode } from "../core/errors.js";
import { APP_VERSION } from "../version.js";
import { captureTelemetryEvent, countBucket, markTelemetryMilestone, uptimeBucket } from "../core/telemetry.js";
import type {
  HttpServerSpec,
  JsonRpcResponse,
  McpxConfig,
  StdioServerSpec,
  UpstreamServerRuntime,
  UpstreamServerSpec,
  UpstreamTokenCount
} from "../types.js";
import { isServerEnabled } from "../types.js";

const SERVER_VERSION = APP_VERSION;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 60_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const HEALTH_WINDOW_MS = 24 * 60 * 60 * 1_000;
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
  health: Record<"tools_call" | "resources_read" | "prompts_get" | "other", { calls: number; successes: number; errors: number }>;
  healthWindowStartedAt: number;
}

type GatewayMethodFamily = "tools_call" | "resources_read" | "prompts_get" | "other";

function gatewayMethodFamily(method: string): GatewayMethodFamily {
  if (method === "tools/call") return "tools_call";
  if (method === "resources/read") return "resources_read";
  if (method === "prompts/get") return "prompts_get";
  return "other";
}

function recordGatewayCall(runtime: GatewayRuntimeState, method: string, response: JsonRpcResponse | null): void {
  if (Date.now() - runtime.healthWindowStartedAt >= HEALTH_WINDOW_MS) {
    emitGatewayHealthSummary(runtime, runtime.healthWindowStartedAt);
    resetGatewayHealth(runtime, Date.now());
  }
  const metric = runtime.health[gatewayMethodFamily(method)];
  metric.calls += 1;
  if (response?.error) {
    metric.errors += 1;
  } else {
    metric.successes += 1;
    markTelemetryMilestone("first_gateway_request_succeeded");
  }
}

function resetGatewayHealth(runtime: GatewayRuntimeState, startedAt: number): void {
  for (const metric of Object.values(runtime.health)) {
    metric.calls = 0;
    metric.successes = 0;
    metric.errors = 0;
  }
  runtime.healthWindowStartedAt = startedAt;
}

function emitGatewayHealthSummary(runtime: GatewayRuntimeState, startedAt: number): void {
  let config: McpxConfig | null = null;
  try {
    config = loadMergedConfig();
  } catch {
    // A telemetry summary is best-effort during shutdown.
  }

  const configuredServerCount = countBucket(config ? Object.keys(config.servers).length : 0);
  const configuredClientCount = countBucket(config ? Object.keys(config.clients).length : 0);
  const configuredPluginCount = countBucket(config ? Object.keys(config.plugins ?? {}).length : 0);
  for (const [methodFamily, metric] of Object.entries(runtime.health) as Array<[GatewayMethodFamily, { calls: number; successes: number; errors: number }]>) {
    if (metric.calls === 0) continue;
    captureTelemetryEvent({
      name: "gateway_health_summary",
      properties: {
        methodFamily,
        callCount: countBucket(metric.calls),
        successCount: countBucket(metric.successes),
        errorCount: countBucket(metric.errors),
        configuredServerCount,
        configuredClientCount,
        configuredPluginCount,
        uptime: uptimeBucket(Date.now() - startedAt)
      }
    });
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

// When tools/resources/prompts fail with different error codes (e.g. tools/list
// 401s while prompts/list merely 404s "method not found"), the auth signal is
// the one the user actually needs to act on -- so it wins regardless of call
// order.
const ERROR_CODE_PRIORITY: UpstreamErrorCode[] = [
  "auth_expired",
  "auth_required",
  "secret_missing",
  "unreachable",
  "timeout",
  "upstream_error"
];

function pickPrimaryErrorCode(errors: Array<{ code?: UpstreamErrorCode }>): string | undefined {
  let best: UpstreamErrorCode | undefined;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const { code } of errors) {
    if (!code) continue;
    const rank = ERROR_CODE_PRIORITY.indexOf(code);
    const effectiveRank = rank === -1 ? ERROR_CODE_PRIORITY.length : rank;
    if (effectiveRank < bestRank) {
      bestRank = effectiveRank;
      best = code;
    }
  }
  return best;
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
    const fingerprint = specFingerprint(upstream.spec, secrets);
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
    const errors: Array<{ label: string; message: string; code?: UpstreamErrorCode }> = [];

    function recordError(label: string, error: unknown): void {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ label, message, code: error instanceof UpstreamError ? error.code : undefined });
    }

    try {
      const toolsResult = await callUpstream(upstream, "tools/list", {}, "token-tools", secrets, runtime) as { tools?: Array<unknown> };
      if (toolsResult && toolsResult.tools) {
        toolsCount = Math.ceil(JSON.stringify(toolsResult.tools).length / 4);
      }
    } catch (error) {
      recordError("tools/list", error);
    }

    try {
      const resourcesResult = await callUpstream(upstream, "resources/list", {}, "token-resources", secrets, runtime) as { resources?: Array<unknown> };
      if (resourcesResult && resourcesResult.resources) {
        resourcesCount = Math.ceil(JSON.stringify(resourcesResult.resources).length / 4);
      }
    } catch (error) {
      recordError("resources/list", error);
    }

    try {
      const promptsResult = await callUpstream(upstream, "prompts/list", {}, "token-prompts", secrets, runtime) as { prompts?: Array<unknown> };
      if (promptsResult && promptsResult.prompts) {
        promptsCount = Math.ceil(JSON.stringify(promptsResult.prompts).length / 4);
      }
    } catch (error) {
      recordError("prompts/list", error);
    }

    const total = toolsCount + resourcesCount + promptsCount;
    const countObj: UpstreamTokenCount = {
      tools: toolsCount,
      resources: resourcesCount,
      prompts: promptsCount,
      total,
      error: errors.length > 0 ? errors.map((e) => `${e.label}: ${e.message}`).join("; ") : undefined,
      errorCode: pickPrimaryErrorCode(errors)
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

function specFingerprint(spec: UpstreamServerSpec, secrets?: SecretsManager): string {
  if (!secrets) return JSON.stringify(spec);
  const resolvedMarkers: Record<string, string> = {};
  const collect = (obj?: Record<string, string>) => {
    if (!obj) return;
    for (const [key, value] of Object.entries(obj)) {
      if (isOAuthReference(value)) {
        // resolveMaybeSecret only understands secret:// refs -- for an
        // oauth:// reference it just returns the value unchanged, and that
        // reference string never changes across a re-login or a token
        // refresh. Without this, the fingerprint stays identical after
        // re-authenticating, the cached upstream connection (with the old
        // bearer token baked into its transport) never gets evicted, and
        // re-auth silently appears to do nothing until an unrelated call
        // happens to invalidate the connection. Use the stored token's
        // obtainedAt instead, which changes on every login and refresh.
        try {
          const serverName = oauthReferenceServerName(value);
          let storedTokens = secrets.getSecret(oauthSecretNames(serverName).tokens);
          if (!storedTokens) {
            // Legacy fallback for old non-hashed secret names
            const legacy = `oauth_${serverName.toLowerCase().replace(/[^a-z0-9._-]/g, "_")}_tokens`;
            storedTokens = secrets.getSecret(legacy);
          }
          const obtainedAt = storedTokens ? (JSON.parse(storedTokens) as { obtainedAt?: number }).obtainedAt : undefined;
          resolvedMarkers[key] = obtainedAt != null ? `oauth:${serverName}:${obtainedAt}` : value;
        } catch {
          resolvedMarkers[key] = value;
        }
      } else if (value.startsWith("secret://")) {
        try { resolvedMarkers[key] = secrets.resolveMaybeSecret(value); } catch { resolvedMarkers[key] = value; }
      }
    }
  };
  if (spec.transport === "stdio") collect(spec.env);
  if (spec.transport === "http") collect(spec.headers);
  return JSON.stringify({ spec, resolvedMarkers });
}

/**
 * The passthrough connection cache key used to be a constant "<name>:passthrough"
 * suffix that didn't depend on the actual token -- so two clients passing
 * different Authorization headers to the same upstream shared one cached
 * connection, and the second one silently executed under the first client's
 * credentials for the life of that connection. Hashed (not raw) so a client's
 * bearer token never ends up sitting in a Map key.
 */
function passthroughCacheSuffix(passthroughAuthorizationHeader: string): string {
  return `passthrough:${crypto.createHash("sha256").update(passthroughAuthorizationHeader).digest("hex").slice(0, 16)}`;
}

const EXTRA_INHERITED_ENV = ["TMPDIR", "LANG"] as const;

function resolveStdioEnv(spec: StdioServerSpec, secrets: SecretsManager): Record<string, string> {
  const env = getDefaultEnvironment();
  for (const key of EXTRA_INHERITED_ENV) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("LC_") && value) env[key] = value;
  }
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

async function reconcileUpstreamConnections(config: McpxConfig, secrets: SecretsManager, runtime: GatewayRuntimeState): Promise<void> {
  const activeSpecs = new Map(
    Object.entries(config.servers)
      .filter(([, spec]) => isServerEnabled(spec))
      .map(([name, spec]) => [name, specFingerprint(spec, secrets)])
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
  const key = passthroughAuthorizationHeader ? `${upstreamName}:${passthroughCacheSuffix(passthroughAuthorizationHeader)}` : upstreamName;
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
  const cacheKey = passthroughAuthorizationHeader ? `${upstream.name}:${passthroughCacheSuffix(passthroughAuthorizationHeader)}` : upstream.name;
  const fingerprint = specFingerprint(upstream.spec, secrets);

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

    const client = new Client(
      { name: "mcpx", version: SERVER_VERSION },
      { versionNegotiation: { mode: { pin: MCP_V2_PROTOCOL_VERSION } } }
    );
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
      && error instanceof SdkHttpError
      && (error.status === 401 || error.status === 403)
    ) {
      return callUpstreamOnce(upstream, method, params, secrets, runtime, passthroughAuthorizationHeader, true);
    }

    // Classify all errors through the structured taxonomy.
    const wwwAuthenticate = runtime.lastWwwAuthenticate?.get(upstream.name);
    throw classifyUpstreamError(upstream.name, error, wwwAuthenticate);
  }
}

/** Constant-time comparison for the local gateway bearer token (a 256-bit secret). */
function tokensMatch(candidate: string | undefined, expectedToken: string): boolean {
  if (!candidate) {
    return false;
  }
  const candidateBuf = Buffer.from(candidate);
  const expectedBuf = Buffer.from(expectedToken);
  // timingSafeEqual throws on mismatched lengths, so check that first -- a length
  // mismatch is itself safe to short-circuit on since it isn't secret-dependent.
  return candidateBuf.length === expectedBuf.length && crypto.timingSafeEqual(candidateBuf, expectedBuf);
}

function authHeaderIsValid(request: http.IncomingMessage, expectedToken: string): boolean {
  const localTokenHeader = request.headers["x-mcpx-local-token"];
  if (typeof localTokenHeader === "string" && tokensMatch(localTokenHeader, expectedToken)) {
    return true;
  }
  if (Array.isArray(localTokenHeader) && localTokenHeader.some((value) => tokensMatch(value, expectedToken))) {
    return true;
  }

  const authHeader = request.headers.authorization;
  if (!authHeader) {
    return false;
  }

  const [scheme, token] = authHeader.split(" ");
  return scheme === "Bearer" && tokensMatch(token, expectedToken);
}

function isAuthChallenge(error: unknown): error is UpstreamError {
  return error instanceof UpstreamError && (error.code === "auth_required" || error.code === "auth_expired");
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
      const existing = cached?.fingerprint === specFingerprint(upstream.spec, secrets) ? cached.count : { tools: 0, resources: 0, prompts: 0, total: 0 };
      existing.tools = Math.ceil(JSON.stringify(result.tools ?? []).length / 4);
      existing.total = existing.tools + existing.resources + existing.prompts;
      delete existing.error;
      runtime.tokenCache.set(upstream.name, { fingerprint: specFingerprint(upstream.spec, secrets), count: existing });

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

  const failedUpstreams = upstreams
    .filter((u) => runtime.upstreamErrors?.has(u.name))
    .map((u) => ({ name: u.name, ...runtime.upstreamErrors!.get(u.name)! }));

  return {
    tools,
    ...(failedUpstreams.length > 0 ? { _meta: { mcpxUpstreamErrors: failedUpstreams } } : {})
  };
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
      const existing = cached?.fingerprint === specFingerprint(upstream.spec, secrets) ? cached.count : { tools: 0, resources: 0, prompts: 0, total: 0 };
      existing.resources = Math.ceil(JSON.stringify(result.resources ?? []).length / 4);
      existing.total = existing.tools + existing.resources + existing.prompts;
      delete existing.error;
      runtime.tokenCache.set(upstream.name, { fingerprint: specFingerprint(upstream.spec, secrets), count: existing });

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

  const failedUpstreams = upstreams
    .filter((u) => runtime.upstreamErrors?.has(u.name))
    .map((u) => ({ name: u.name, ...runtime.upstreamErrors!.get(u.name)! }));

  return {
    resources,
    ...(failedUpstreams.length > 0 ? { _meta: { mcpxUpstreamErrors: failedUpstreams } } : {})
  };
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
      const existing = cached?.fingerprint === specFingerprint(upstream.spec, secrets) ? cached.count : { tools: 0, resources: 0, prompts: 0, total: 0 };
      existing.prompts = Math.ceil(JSON.stringify(result.prompts ?? []).length / 4);
      existing.total = existing.tools + existing.resources + existing.prompts;
      delete existing.error;
      runtime.tokenCache.set(upstream.name, { fingerprint: specFingerprint(upstream.spec, secrets), count: existing });

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

  const failedUpstreams = upstreams
    .filter((u) => runtime.upstreamErrors?.has(u.name))
    .map((u) => ({ name: u.name, ...runtime.upstreamErrors!.get(u.name)! }));

  return {
    prompts,
    ...(failedUpstreams.length > 0 ? { _meta: { mcpxUpstreamErrors: failedUpstreams } } : {})
  };
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

function getClientAuthorizationFromWebRequest(request: Request | undefined, expectedToken: string): string | undefined {
  const authHeader = request?.headers.get("authorization");
  if (!authHeader) {
    return undefined;
  }

  const [scheme, token] = authHeader.split(" ");
  if (scheme === "Bearer" && tokensMatch(token, expectedToken)) {
    return undefined;
  }

  return authHeader;
}

async function prepareGatewayRequest(
  request: Request | undefined,
  expectedToken: string,
  runtime: GatewayRuntimeState,
  secrets: SecretsManager,
  upstreamFilter: string | undefined
): Promise<{ config: McpxConfig; clientAuthorizationHeader?: string }> {
  const config = loadMergedConfig();
  if (upstreamFilter && listUpstreams(config, upstreamFilter).length === 0) {
    throw new ProtocolError(-32602, `Unknown upstream: ${upstreamFilter}`);
  }
  await reconcileUpstreamConnections(config, secrets, runtime);
  return {
    config,
    clientAuthorizationHeader: getClientAuthorizationFromWebRequest(request, expectedToken)
  };
}

async function routeGatewayCall(
  config: McpxConfig,
  method: "tools/call" | "resources/read" | "prompts/get",
  params: Record<string, unknown> | undefined,
  secrets: SecretsManager,
  runtime: GatewayRuntimeState,
  upstreamFilter: string | undefined,
  clientAuthorizationHeader: string | undefined
): Promise<unknown> {
  let response: JsonRpcResponse;
  try {
    response = await routeNamespacedCall(
      config,
      method,
      params,
      null,
      secrets,
      runtime,
      upstreamFilter,
      clientAuthorizationHeader
    );
  } catch (error) {
    if (isAuthChallenge(error)) {
      throw new ProtocolError(-32001, "Upstream authentication required.", {
        mcpxCode: error.code,
        status: error.status,
        upstream: error.upstream,
        wwwAuthenticate: error.wwwAuthenticate
      });
    }
    throw error;
  }
  if (response.error) {
    throw new ProtocolError(response.error.code, response.error.message, response.error.data);
  }
  return response.result;
}

function createGatewayMcpHandler(
  options: GatewayServerOptions,
  runtime: GatewayRuntimeState
): ReturnType<typeof createMcpHandler> {
  return createMcpHandler(
    async (context) => {
      const requestUrl = new URL(context.requestInfo?.url ?? "http://127.0.0.1/mcp");
      const upstreamFilter = getRequestedUpstream(requestUrl);
      const request = context.requestInfo;
      const clientAuthorizationHeader = getClientAuthorizationFromWebRequest(request, options.expectedToken);
      const server = new Server(
        { name: "mcpx", version: SERVER_VERSION },
        {
          capabilities: {
            tools: {},
            resources: {},
            prompts: {}
          },
          supportedProtocolVersions: [MCP_V2_PROTOCOL_VERSION]
        }
      );

      const recordSuccessOrFailure = async <T>(method: string, work: () => Promise<T>): Promise<T> => {
        try {
          const result = await work();
          recordGatewayCall(runtime, method, null);
          return result;
        } catch (error) {
          recordGatewayCall(runtime, method, makeError(null, -32000, error instanceof Error ? error.message : String(error)));
          if (isAuthChallenge(error)) {
            throw new ProtocolError(-32001, "Upstream authentication required.", {
              mcpxCode: error.code,
              status: error.status,
              upstream: error.upstream,
              wwwAuthenticate: error.wwwAuthenticate
            });
          }
          throw error;
        }
      };

      server.setRequestHandler("tools/list", async (_request, _context) => {
        return recordSuccessOrFailure("tools/list", async () => {
          const { config } = await prepareGatewayRequest(request, options.expectedToken, runtime, options.secrets, upstreamFilter);
          return handleListTools(config, options.secrets, runtime, upstreamFilter, clientAuthorizationHeader);
        }) as Promise<any>;
      });
      server.setRequestHandler("resources/list", async (_request, _context) => {
        return recordSuccessOrFailure("resources/list", async () => {
          const { config } = await prepareGatewayRequest(request, options.expectedToken, runtime, options.secrets, upstreamFilter);
          return handleListResources(config, options.secrets, runtime, upstreamFilter, clientAuthorizationHeader);
        }) as Promise<any>;
      });
      server.setRequestHandler("prompts/list", async (_request, _context) => {
        return recordSuccessOrFailure("prompts/list", async () => {
          const { config } = await prepareGatewayRequest(request, options.expectedToken, runtime, options.secrets, upstreamFilter);
          return handleListPrompts(config, options.secrets, runtime, upstreamFilter, clientAuthorizationHeader);
        }) as Promise<any>;
      });
      server.setRequestHandler("tools/call", async (request, context) => {
        return recordSuccessOrFailure("tools/call", async () => {
          const { config } = await prepareGatewayRequest(context.http?.req, options.expectedToken, runtime, options.secrets, upstreamFilter);
          return routeGatewayCall(config, "tools/call", request.params as Record<string, unknown> | undefined, options.secrets, runtime, upstreamFilter, clientAuthorizationHeader) as Promise<any>;
        });
      });
      server.setRequestHandler("resources/read", async (request, context) => {
        return recordSuccessOrFailure("resources/read", async () => {
          const { config } = await prepareGatewayRequest(context.http?.req, options.expectedToken, runtime, options.secrets, upstreamFilter);
          return routeGatewayCall(config, "resources/read", request.params as Record<string, unknown> | undefined, options.secrets, runtime, upstreamFilter, clientAuthorizationHeader) as Promise<any>;
        });
      });
      server.setRequestHandler("prompts/get", async (request, context) => {
        return recordSuccessOrFailure("prompts/get", async () => {
          const { config } = await prepareGatewayRequest(context.http?.req, options.expectedToken, runtime, options.secrets, upstreamFilter);
          return routeGatewayCall(config, "prompts/get", request.params as Record<string, unknown> | undefined, options.secrets, runtime, upstreamFilter, clientAuthorizationHeader) as Promise<any>;
        });
      });

      return server;
    },
    {
      legacy: "reject",
      responseMode: "auto",
      onerror: (error) => {
        if (process.env.MCPX_GATEWAY_DEBUG === "1") {
          console.error(`[mcpx gateway] MCP handler error: ${error.message}`);
        }
      }
    }
  );
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
    // resolveMaybeSecret only understands secret:// refs; for an oauth://
    // reference it would return the literal string unchanged, forwarding a
    // nonsensical "Authorization: oauth://<name>" header upstream. Resolve
    // it to a real bearer token the same way the MCP call path does.
    if (key.toLowerCase() === "authorization" && isOAuthReference(value)) {
      try {
        const accessToken = await getOAuthAccessToken(oauthReferenceServerName(value), upstream.spec, secrets);
        headers[key] = `Bearer ${accessToken}`;
      } catch {
        // No usable token -- omit the header rather than sending the raw
        // oauth:// marker; the upstream will respond as it would to any
        // other unauthenticated well-known request.
      }
    } else {
      headers[key] = secrets.resolveMaybeSecret(value);
    }
  }

  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(() => timeoutController.abort(), DEFAULT_CONNECT_TIMEOUT_MS);
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamWellKnownUrl, {
      method: "GET",
      headers,
      signal: timeoutController.signal
    });
  } catch (error) {
    const isAbort = (error as { name?: string }).name === "AbortError";
    response.statusCode = 502;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      error: "upstream_unreachable",
      message: isAbort
        ? `Well-known request timed out after ${DEFAULT_CONNECT_TIMEOUT_MS}ms.`
        : (error instanceof Error ? error.message : String(error))
    }));
    return true;
  } finally {
    clearTimeout(timeoutHandle);
  }
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

const SENSITIVE_HEADER_NAMES = new Set(["authorization", "x-mcpx-local-token"]);

function redactSensitiveHeaders(headers: http.IncomingHttpHeaders): http.IncomingHttpHeaders {
  const redacted: http.IncomingHttpHeaders = { ...headers };
  for (const name of Object.keys(redacted)) {
    if (SENSITIVE_HEADER_NAMES.has(name.toLowerCase())) {
      redacted[name] = "[redacted]";
    }
  }
  return redacted;
}

export function createGatewayServer(options: GatewayServerOptions): http.Server {
  const debug = process.env.MCPX_GATEWAY_DEBUG === "1";
  const runtime: GatewayRuntimeState = {
    upstreamConnections: new Map(),
    upstreamErrors: new Map(),
    health: {
      tools_call: { calls: 0, successes: 0, errors: 0 },
      resources_read: { calls: 0, successes: 0, errors: 0 },
      prompts_get: { calls: 0, successes: 0, errors: 0 },
      other: { calls: 0, successes: 0, errors: 0 }
    },
    healthWindowStartedAt: Date.now()
  };
  const startedAt = Date.now();
  const mcpHandler = createGatewayMcpHandler(options, runtime);
  const handleMcpRequest = async (request: http.IncomingMessage, response: http.ServerResponse, requestUrl: URL): Promise<void> => {
    const webRequest = await toWebRequest(request);
    const webResponse = await mcpHandler.fetch(webRequest);
    const body = await webResponse.text();
    let statusCode = webResponse.status;
    let authChallenge: string | undefined;
    try {
      const payload = JSON.parse(body) as { error?: { data?: { mcpxCode?: string; status?: number; wwwAuthenticate?: string } } };
      const errorData = payload.error?.data;
      if (errorData?.mcpxCode === "auth_required" || errorData?.mcpxCode === "auth_expired") {
        statusCode = errorData.status ?? 401;
        if (errorData.wwwAuthenticate) {
          const localResourceMetadataUrl = appendUpstreamQuery(
            `${getLocalOriginFromRequest(request)}/.well-known/oauth-protected-resource`,
            getRequestedUpstream(requestUrl)
          );
          authChallenge = rewriteWwwAuthenticateResourceMetadata(errorData.wwwAuthenticate, localResourceMetadataUrl);
        }
      }
    } catch {
      // Non-JSON responses are forwarded unchanged.
    }

    response.statusCode = statusCode;
    for (const [name, value] of webResponse.headers) {
      if (name.toLowerCase() === "content-length") continue;
      response.setHeader(name, value);
    }
    if (authChallenge) {
      response.setHeader("www-authenticate", authChallenge);
    }
    response.end(body);
  };

  const server = http.createServer(async (request, response) => {
    let requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    try {
      requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
      if (debug) {
        console.error(`[mcpx gateway] ${request.method ?? "?"} ${requestUrl.pathname} auth=${request.headers.authorization ? "yes" : "no"} accept=${request.headers.accept ?? ""}`);
        // Redact credential-bearing headers -- MCPX_GATEWAY_DEBUG dumps every
        // request to the daemon log, which is exactly the file a user attaches
        // to a bug report. The local gateway token and any passthrough
        // upstream OAuth token must never land there in cleartext.
        console.error(`[mcpx gateway] headers=${JSON.stringify(redactSensitiveHeaders(request.headers))}`);
      }

      if (await maybeHandleWellKnownOAuthRequest(request, response, requestUrl, options.secrets)) {
        if (debug) {
          console.error(`[mcpx gateway] -> ${response.statusCode} (well-known oauth)`);
        }
        return;
      }

      if (requestUrl.pathname === "/health") {
        if (!authHeaderIsValid(request, options.expectedToken)) {
          response.statusCode = 401;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
        response.statusCode = 200;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ ok: true, server: "mcpx", protocolVersion: MCP_V2_PROTOCOL_VERSION }));
        return;
      }

      if (requestUrl.pathname === "/internal/token-counts" || requestUrl.pathname === "/internal/token-counts/refresh") {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.setHeader("allow", "POST");
          response.end("Method Not Allowed");
          return;
        }
        if (!authHeaderIsValid(request, options.expectedToken)) {
          response.statusCode = 401;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
        const config = loadMergedConfig();
        await reconcileUpstreamConnections(config, options.secrets, runtime);
        if (requestUrl.pathname.endsWith("/refresh")) {
          runtime.tokenCache?.clear();
        }
        const counts = await getUpstreamTokenCounts(config, options.secrets, runtime);
        response.statusCode = 200;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ counts }));
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

      if (!authHeaderIsValid(request, options.expectedToken)) {
        response.statusCode = 401;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ error: "unauthorized" }));
        if (debug) {
          console.error(`[mcpx gateway] -> 401 (MCP unauthorized)`);
        }
        return;
      }

      await handleMcpRequest(request, response, requestUrl);
    } catch (error) {
      if (isAuthChallenge(error)) {
        response.statusCode = error.status ?? 401;
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
    emitGatewayHealthSummary(runtime, startedAt);
    void mcpHandler.close();
    for (const entry of runtime.upstreamConnections.values()) {
      void closeUpstreamConnection(entry);
    }
    runtime.upstreamConnections.clear();
  });

  server.listen(options.port, "127.0.0.1");
  return server;
}
