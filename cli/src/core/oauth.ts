import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import {
  auth,
  discoverOAuthServerInfo,
  discoverOAuthProtectedResourceMetadata,
  discoverAuthorizationServerMetadata,
  refreshAuthorization,
  type OAuthClientProvider,
  type OAuthDiscoveryState
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { InvalidClientError, InvalidGrantError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { HttpServerSpec, McpxConfig, UpstreamServerSpec } from "../types.js";
import { loadConfig } from "./config.js";
import { mutateConfig } from "./config-store.js";
import { SecretsManager } from "./secrets.js";
import { syncAllClients, persistSyncState } from "./sync.js";
import { UpstreamError } from "./errors.js";
import { getOAuthLockPath, ensureDir } from "./paths.js";

interface StoredOAuthTokens {
  tokens: OAuthTokens;
  obtainedAt: number;
}

function oauthSecretName(serverName: string, suffix: "client" | "tokens" | "verifier" | "discovery"): string {
  return `oauth_${serverName.toLowerCase().replace(/[^a-z0-9._-]/g, "_")}_${suffix}`;
}

function readJsonSecret<T>(secrets: SecretsManager, name: string): T | undefined {
  const raw = secrets.getSecret(name);
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function writeJsonSecret(secrets: SecretsManager, name: string, value: unknown): void {
  secrets.setSecret(name, JSON.stringify(value));
}

export function isOAuthReference(value: string): boolean {
  return value.startsWith("oauth://");
}

export function oauthReferenceServerName(value: string): string {
  if (!isOAuthReference(value)) {
    throw new Error(`Not an OAuth reference: ${value}`);
  }
  return decodeURIComponent(value.slice("oauth://".length));
}

/**
 * Whether an HTTP MCP server advertises OAuth support, determined by attempting
 * RFC 9728 / RFC 8414 discovery and inspecting what came back.
 *
 * "unknown" vs "unsupported" is a real distinction, not decoration. RFC 9728
 * protected-resource metadata is checked directly (and independently of RFC 8414)
 * because its presence alone is authoritative proof of OAuth support — we must
 * not lose that positive signal just because the authorization server it points
 * to happens to be unreachable at probe time (discoverOAuthServerInfo's combined
 * walk would throw in that case and discard the resourceMetadata result it
 * already had). We track whether we ever received an actual HTTP response during
 * discovery; if we never did, the probe couldn't reach the server at all and the
 * verdict must be "unknown" so a flaky network never permanently hides the sign-in
 * option.
 */
export type OAuthSupport = "supported" | "unsupported" | "unknown";

export interface OAuthSupportProbe {
  support: OAuthSupport;
  authorizationServerUrl?: string;
  resourceMetadata: boolean;
  authorizationServerMetadata: boolean;
  error?: string;
}

const DEFAULT_OAUTH_SUPPORT_TIMEOUT_MS = 5000;
const OAUTH_SUPPORT_SUPPORTED_TTL_MS = 5 * 60_000;
const OAUTH_SUPPORT_NEGATIVE_TTL_MS = 60_000;

const oauthSupportCache = new Map<string, { at: number; probe: OAuthSupportProbe }>();

/** Test-only: clears the in-memory OAuth support cache. */
export function __resetOAuthSupportCache(): void {
  oauthSupportCache.clear();
}

export async function probeOAuthSupport(
  serverUrl: string,
  options: { timeoutMs?: number; force?: boolean } = {}
): Promise<OAuthSupportProbe> {
  const cached = oauthSupportCache.get(serverUrl);
  if (!options.force && cached) {
    const ttl = cached.probe.support === "unsupported" ? OAUTH_SUPPORT_NEGATIVE_TTL_MS : OAUTH_SUPPORT_SUPPORTED_TTL_MS;
    if (Date.now() - cached.at < ttl) {
      return cached.probe;
    }
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_OAUTH_SUPPORT_TIMEOUT_MS;
  let sawResponse = false;
  const timeoutFetch: typeof fetch = async (input, init) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      sawResponse = true;
      return response;
    } finally {
      clearTimeout(timeout);
    }
  };

  let resourceMetadataFound = false;
  let authorizationServerUrl: string | undefined;
  try {
    const resourceMetadata = await discoverOAuthProtectedResourceMetadata(serverUrl, {}, timeoutFetch);
    resourceMetadataFound = true;
    authorizationServerUrl = resourceMetadata.authorization_servers?.[0];
  } catch {
    // Not found, unreachable, or malformed — all fall through to the RFC 8414 check.
    // sawResponse (set inside timeoutFetch) is what distinguishes "not found" from
    // "couldn't check" below, not this catch.
  }

  let authServerMetadataFound = false;
  if (!resourceMetadataFound) {
    try {
      // Legacy fallback per the MCP spec: treat the MCP server's own origin as the
      // authorization server when RFC 9728 isn't present.
      const fallbackAuthServerUrl = new URL("/", serverUrl);
      const metadata = await discoverAuthorizationServerMetadata(fallbackAuthServerUrl, { fetchFn: timeoutFetch });
      authServerMetadataFound = metadata != null;
      if (authServerMetadataFound) {
        authorizationServerUrl = fallbackAuthServerUrl.toString();
      }
    } catch {
      // Same reasoning as above.
    }
  }

  let probe: OAuthSupportProbe;
  if (resourceMetadataFound || authServerMetadataFound) {
    probe = {
      support: "supported",
      authorizationServerUrl,
      resourceMetadata: resourceMetadataFound,
      authorizationServerMetadata: authServerMetadataFound
    };
  } else if (sawResponse) {
    // We got at least one real HTTP response somewhere in the discovery chain and
    // none of it indicated OAuth support — this is a genuine negative result.
    probe = { support: "unsupported", resourceMetadata: false, authorizationServerMetadata: false };
  } else {
    probe = {
      support: "unknown",
      resourceMetadata: false,
      authorizationServerMetadata: false,
      error: "Could not reach the server to check for OAuth support."
    };
  }

  oauthSupportCache.set(serverUrl, { at: Date.now(), probe });
  return probe;
}

function tokensAreExpiring(tokens: StoredOAuthTokens): boolean {
  if (!tokens.tokens.expires_in) {
    return false;
  }

  const expiresAt = tokens.obtainedAt + tokens.tokens.expires_in * 1000;
  return Date.now() >= expiresAt - 60_000;
}

class McpxOAuthProvider implements OAuthClientProvider {
  readonly #serverName: string;
  readonly #secrets: SecretsManager;
  readonly #redirectUrlValue?: string;
  readonly #stateValue: string;

  constructor(serverName: string, secrets: SecretsManager, redirectUrl?: string, state: string = crypto.randomUUID()) {
    this.#serverName = serverName;
    this.#secrets = secrets;
    this.#redirectUrlValue = redirectUrl;
    this.#stateValue = state;
  }

  get redirectUrl(): string | undefined {
    return this.#redirectUrlValue;
  }

  get clientMetadata(): OAuthClientMetadata {
    if (!this.#redirectUrlValue) {
      return {
        redirect_uris: [],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        client_name: "mcpx"
      };
    }

    return {
      redirect_uris: [this.#redirectUrlValue],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "mcpx"
    };
  }

  state(): string {
    return this.#stateValue;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return readJsonSecret<OAuthClientInformationMixed>(this.#secrets, oauthSecretName(this.#serverName, "client"));
  }

  saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
    writeJsonSecret(this.#secrets, oauthSecretName(this.#serverName, "client"), clientInformation);
  }

  tokens(): OAuthTokens | undefined {
    return readJsonSecret<StoredOAuthTokens>(this.#secrets, oauthSecretName(this.#serverName, "tokens"))?.tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    writeJsonSecret(this.#secrets, oauthSecretName(this.#serverName, "tokens"), {
      tokens,
      obtainedAt: Date.now()
    } satisfies StoredOAuthTokens);
  }

  redirectToAuthorization(_authorizationUrl: URL): void {
    // runOAuthLogin supplies an openUrl callback and overrides this method below.
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.#secrets.setSecret(oauthSecretName(this.#serverName, "verifier"), codeVerifier);
  }

  codeVerifier(): string {
    const verifier = this.#secrets.getSecret(oauthSecretName(this.#serverName, "verifier"));
    if (!verifier) {
      throw new Error(`Missing OAuth code verifier for "${this.#serverName}".`);
    }
    return verifier;
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    writeJsonSecret(this.#secrets, oauthSecretName(this.#serverName, "discovery"), state);
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return readJsonSecret<OAuthDiscoveryState>(this.#secrets, oauthSecretName(this.#serverName, "discovery"));
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    const suffixes = scope === "all" ? ["client", "tokens", "verifier", "discovery"] as const : [scope];
    for (const suffix of suffixes) {
      this.#secrets.removeSecret(oauthSecretName(this.#serverName, suffix));
    }
  }
}

class InteractiveOAuthProvider extends McpxOAuthProvider {
  readonly #openUrl: (url: string) => void | Promise<void>;
  #cachedClientInfo: OAuthClientInformationMixed | undefined;
  #cachedCodeVerifier: string | undefined;

  constructor(serverName: string, secrets: SecretsManager, redirectUrl: string, state: string, openUrl: (url: string) => void | Promise<void>) {
    super(serverName, secrets, redirectUrl, state);
    this.#openUrl = openUrl;
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.#openUrl(authorizationUrl.toString());
  }

  /** Cache credentials in memory to survive the SDK's retry path
   *  (which calls invalidateCredentials('all') on InvalidClientError). Also
   *  insulates against intermittent keychain read failures. */
  clientInformation(): OAuthClientInformationMixed | undefined {
    this.#cachedClientInfo ??= super.clientInformation();
    return this.#cachedClientInfo;
  }

  saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
    super.saveClientInformation(clientInformation);
    this.#cachedClientInfo = clientInformation;
  }

  codeVerifier(): string {
    if (this.#cachedCodeVerifier !== undefined) {
      return this.#cachedCodeVerifier;
    }
    return super.codeVerifier();
  }

  saveCodeVerifier(codeVerifier: string): void {
    super.saveCodeVerifier(codeVerifier);
    this.#cachedCodeVerifier = codeVerifier;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    super.invalidateCredentials(scope);
    if (scope === "all" || scope === "client") {
      this.#cachedClientInfo = undefined;
    }
  }
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to start OAuth callback server."));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

export const OAUTH_LOGIN_TIMEOUT_MS = 120_000;

function renderCallbackPage(kind: "success" | "error", detail?: string): string {
  const title = kind === "success" ? "Signed in" : "Sign-in failed";
  const message =
    kind === "success"
      ? "You're signed in. You can close this window and return to mcpx."
      : (detail ?? "Something went wrong. You can close this window and try again in mcpx.");
  const icon = kind === "success" ? "&#10003;" : "&#10007;";
  const closeScript = kind === "success" ? "<script>setTimeout(() => window.close(), 1500);</script>" : "";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title} — mcpx</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #f5f5f7; color: #1d1d1f;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #1c1c1e; color: #f5f5f7; }
    .card { background: #2c2c2e !important; box-shadow: none !important; }
  }
  .card {
    background: #fff; border-radius: 16px; padding: 40px 48px; text-align: center;
    box-shadow: 0 8px 30px rgba(0,0,0,0.12); max-width: 360px;
  }
  .icon {
    width: 48px; height: 48px; border-radius: 50%; margin: 0 auto 16px;
    display: flex; align-items: center; justify-content: center; font-size: 22px;
    background: ${kind === "success" ? "#34c759" : "#ff3b30"}; color: #fff;
  }
  h1 { font-size: 17px; margin: 0 0 8px; }
  p { font-size: 14px; margin: 0; opacity: 0.7; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
  ${closeScript}
</body>
</html>`;
}

export class OAuthCancelledError extends Error {
  readonly code = "oauth_cancelled";
  constructor(serverName: string) {
    super(`OAuth login for "${serverName}" was cancelled.`);
    this.name = "OAuthCancelledError";
  }
}

export class OAuthLoginInProgressError extends Error {
  readonly code = "oauth_in_progress";
  constructor(serverName: string, holderPid?: number) {
    super(
      holderPid
        ? `OAuth login for "${serverName}" is already in progress (pid ${holderPid}).`
        : `OAuth login for "${serverName}" is already in progress.`
    );
    this.name = "OAuthLoginInProgressError";
  }
}

/**
 * Waits for the browser to redirect back to the local callback server with an
 * authorization code. Only requests to the exact "/callback" path are treated as
 * the callback; everything else (favicons, stray retries) is answered without
 * touching the outcome. A `settled` guard ensures the promise resolves/rejects
 * exactly once even if the browser (or an IdP that double-redirects) hits the
 * server again afterward — late requests just get a plain response.
 */
function waitForAuthorizationCode(
  server: http.Server,
  serverName: string,
  expectedState: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? OAUTH_LOGIN_TIMEOUT_MS;
  const { signal } = options;

  return new Promise((resolve, reject) => {
    let settled = false;

    function settle(fn: () => void): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      fn();
    }

    function onAbort(): void {
      settle(() => reject(new OAuthCancelledError(serverName)));
    }

    const timeout = setTimeout(() => {
      settle(() => reject(new Error(`OAuth login timed out after ${timeoutMs}ms.`)));
    }, timeoutMs);

    if (signal) {
      if (signal.aborted) {
        settle(() => reject(new OAuthCancelledError(serverName)));
        return;
      }
      signal.addEventListener("abort", onAbort);
    }

    server.on("request", (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      if (settled) {
        response.statusCode = 404;
        response.end();
        return;
      }

      if (url.pathname === "/favicon.ico") {
        response.statusCode = 204;
        response.end();
        return;
      }

      if (url.pathname !== "/callback") {
        response.statusCode = 404;
        response.end();
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      response.setHeader("content-type", "text/html; charset=utf-8");

      if (error) {
        response.statusCode = 400;
        response.end(renderCallbackPage("error", `Authorization failed: ${error}`));
        settle(() => reject(new Error(`OAuth authorization failed: ${error}`)));
        return;
      }

      if (!code) {
        response.statusCode = 400;
        response.end(renderCallbackPage("error", "Missing authorization code."));
        return;
      }

      if (state !== expectedState) {
        response.statusCode = 400;
        response.end(renderCallbackPage("error", "This sign-in link is no longer valid."));
        settle(() => reject(new Error("OAuth state mismatch.")));
        return;
      }

      response.end(renderCallbackPage("success"));
      settle(() => resolve(code));
    });
  });
}

function bindOAuthReference(config: McpxConfig, serverName: string): void {
  const spec = config.servers[serverName];
  if (!spec) {
    throw new Error(`Server "${serverName}" not found.`);
  }
  if (spec.transport !== "http") {
    throw new Error(`OAuth login only supports HTTP servers.`);
  }

  spec.headers = {
    ...(spec.headers ?? {}),
    Authorization: `oauth://${encodeURIComponent(serverName)}`
  };
}

export interface OAuthCodeReceiver {
  redirectUrl: string;
  waitForCode: (expectedState: string, timeoutMs?: number) => Promise<string>;
}

export type OAuthProgressEvent =
  | { phase: "discovering" }
  | { phase: "awaiting-browser"; authorizationUrl: string; expiresAt: number }
  | { phase: "exchanging" }
  | { phase: "syncing" };

export interface RunOAuthLoginOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (event: OAuthProgressEvent) => void;
}

const OAUTH_LOCK_STALE_MS = 5 * 60_000;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function releaseOAuthLoginLock(lockPath: string): void {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // best effort
  }
}

/**
 * Cross-process guard against two `runOAuthLogin` calls for the same server
 * running concurrently (e.g. `mcpx auth login` in a terminal while the desktop
 * app is also mid-flow — the daemon and Electron are separate processes sharing
 * the same secrets file). Same-process double-clicks are expected to be deduped
 * by the caller before ever reaching here; this is the last-resort cross-process
 * net, so it fails fast rather than queuing.
 */
function acquireOAuthLoginLock(serverName: string): () => void {
  const lockPath = getOAuthLockPath(serverName);
  ensureDir(path.dirname(lockPath));

  const tryCreate = (): boolean => {
    try {
      fs.writeFileSync(lockPath, `${process.pid}\n`, { flag: "wx" });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        throw err;
      }
      return false;
    }
  };

  if (tryCreate()) {
    return () => releaseOAuthLoginLock(lockPath);
  }

  let holderPid: number | undefined;
  try {
    const raw = fs.readFileSync(lockPath, "utf8").trim();
    const pid = Number(raw);
    const stat = fs.statSync(lockPath);
    const stale = Date.now() - stat.mtimeMs > OAUTH_LOCK_STALE_MS;
    const holderAlive = Number.isFinite(pid) && pid > 0 && isProcessAlive(pid);

    if (!holderAlive || stale) {
      fs.unlinkSync(lockPath);
      if (tryCreate()) {
        return () => releaseOAuthLoginLock(lockPath);
      }
    }
    holderPid = holderAlive ? pid : undefined;
  } catch {
    // Lock file vanished mid-check or is unreadable — one more attempt to create it.
    if (tryCreate()) {
      return () => releaseOAuthLoginLock(lockPath);
    }
  }

  throw new OAuthLoginInProgressError(serverName, holderPid);
}

export async function runOAuthLogin(
  serverName: string,
  spec: HttpServerSpec,
  secrets: SecretsManager,
  openUrl: (url: string) => void | Promise<void>,
  configPath?: string,
  codeReceiver?: OAuthCodeReceiver,
  options: RunOAuthLoginOptions = {}
): Promise<{ serverName: string; authorized: true }> {
  const { signal, onProgress } = options;
  const timeoutMs = options.timeoutMs ?? OAUTH_LOGIN_TIMEOUT_MS;

  if (signal?.aborted) {
    throw new OAuthCancelledError(serverName);
  }

  const releaseLock = acquireOAuthLoginLock(serverName);

  try {
    const oauthName = oauthSecretName(serverName, "tokens");
    const clientName = oauthSecretName(serverName, "client");

    // Snapshot existing tokens so we can restore them if the flow fails.
    const backupTokens = secrets.getSecret(oauthName);
    const backupClient = secrets.getSecret(clientName);

    // Clear verifier and discovery so the fresh flow starts clean (DCR, PKCE, etc.)
    // but preserve tokens and client secrets — a failed re-auth should not destroy working credentials.
    new McpxOAuthProvider(serverName, secrets).invalidateCredentials("verifier");
    new McpxOAuthProvider(serverName, secrets).invalidateCredentials("discovery");

    const state = crypto.randomUUID();
    let callbackServer: http.Server | undefined;
    let redirectUrl: string;
    let codePromise: Promise<string>;

    if (codeReceiver) {
      redirectUrl = codeReceiver.redirectUrl;
      codePromise = codeReceiver.waitForCode(state, timeoutMs);
    } else {
      callbackServer = http.createServer();
      const port = await listen(callbackServer);
      redirectUrl = `http://127.0.0.1:${port}/callback`;
      codePromise = waitForAuthorizationCode(callbackServer, serverName, state, { timeoutMs, signal });
    }
    // Mark the rejection as handled immediately so that a codePromise which rejects
    // before it is awaited below (e.g. discovery/registration fails first) doesn't
    // crash the process as an unhandled promise rejection. The `await codePromise`
    // further down still observes and propagates the rejection normally.
    codePromise.catch(() => {});

    const wrappedOpenUrl = async (url: string): Promise<void> => {
      onProgress?.({ phase: "awaiting-browser", authorizationUrl: url, expiresAt: Date.now() + timeoutMs });
      await openUrl(url);
    };

    const provider = new InteractiveOAuthProvider(serverName, secrets, redirectUrl, state, wrappedOpenUrl);

    try {
      onProgress?.({ phase: "discovering" });
      const initial = await auth(provider, {
        serverUrl: spec.url
      });
      if (initial !== "REDIRECT") {
        throw new Error(`Expected OAuth redirect for "${serverName}", got ${initial}.`);
      }

      if (signal?.aborted) {
        throw new OAuthCancelledError(serverName);
      }

      const authorizationCode = await codePromise;

      onProgress?.({ phase: "exchanging" });
      const result = await auth(provider, {
        serverUrl: spec.url,
        authorizationCode
      });
      if (result !== "AUTHORIZED") {
        throw new Error(`OAuth login did not authorize "${serverName}".`);
      }

      onProgress?.({ phase: "syncing" });
      await mutateConfig((config) => {
        bindOAuthReference(config, serverName);
      }, configPath);
      const config = loadConfig(configPath);
      const summary = syncAllClients(config, secrets);
      await mutateConfig((freshConfig) => {
        persistSyncState(summary, freshConfig);
      }, configPath);

      new McpxOAuthProvider(serverName, secrets).invalidateCredentials("verifier");
      return { serverName, authorized: true };
    } catch (error) {
      // Restore tokens on failure so working credentials are never destroyed
      if (backupTokens) secrets.setSecret(oauthName, backupTokens);
      if (backupClient) secrets.setSecret(clientName, backupClient);
      new McpxOAuthProvider(serverName, secrets).invalidateCredentials("verifier");
      throw error;
    } finally {
      if (callbackServer) {
        await closeServer(callbackServer);
      }
    }
  } finally {
    releaseLock();
  }
}

export async function getOAuthAccessToken(
  serverName: string,
  spec: HttpServerSpec,
  secrets: SecretsManager,
  options: { forceRefresh?: boolean } = {}
): Promise<string> {
  const stored = readJsonSecret<StoredOAuthTokens>(secrets, oauthSecretName(serverName, "tokens"));
  if (!stored) {
    throw new UpstreamError(serverName, "auth_required", `No OAuth tokens stored for "${serverName}".`);
  }

  // If token is hard-expired (past expires_at + 60s buffer) with no refresh, classify as auth_expired.
  // Within the buffer, still return the existing token.
  if (options.forceRefresh || tokensAreExpiring(stored)) {
    if (!stored.tokens.refresh_token) {
      if (!options.forceRefresh) {
        return stored.tokens.access_token;
      }
      throw new UpstreamError(serverName, "auth_expired", `No refresh token for "${serverName}". Re-authentication required.`);
    }

    const provider = new McpxOAuthProvider(serverName, secrets);
    const clientInformation = provider.clientInformation();
    if (!clientInformation) {
      throw new UpstreamError(serverName, "auth_expired", `No OAuth client info for "${serverName}". Re-authentication required.`);
    }

    let serverInfo: Awaited<ReturnType<typeof discoverOAuthServerInfo>>;
    try {
      const cachedDiscovery = provider.discoveryState();
      serverInfo = cachedDiscovery ?? await discoverOAuthServerInfo(spec.url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(message)) {
        throw new UpstreamError(serverName, "unreachable", `OAuth discovery failed: ${message}`);
      }
      throw new UpstreamError(serverName, "upstream_error", `OAuth discovery failed: ${message}`);
    }

    try {
      const refreshed = await refreshAuthorization(serverInfo.authorizationServerUrl, {
        metadata: serverInfo.authorizationServerMetadata,
        clientInformation,
        refreshToken: stored.tokens.refresh_token,
        resource: serverInfo.resourceMetadata?.resource ? new URL(serverInfo.resourceMetadata.resource) : undefined
      });
      provider.saveTokens(refreshed);
      return refreshed.access_token;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Token endpoint 4xx / invalid_grant / invalid_client → auth_expired (keep tokens).
      // The SDK throws typed InvalidGrantError/InvalidClientError instances whose
      // `.message` is only the server's error_description (the literal string
      // "invalid_grant" never appears there for a spec-compliant response), so detect
      // those SDK error classes directly; the regex remains a fallback for errors that
      // aren't instances of the SDK's OAuth error classes.
      if (err instanceof InvalidGrantError || err instanceof InvalidClientError || /invalid_grant|invalid_client|4\d{2}/i.test(message)) {
        throw new UpstreamError(serverName, "auth_expired", `OAuth refresh failed: ${message}`);
      }
      // Network errors → unreachable (keep tokens)
      if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(message)) {
        throw new UpstreamError(serverName, "unreachable", `OAuth refresh failed: ${message}`);
      }
      throw new UpstreamError(serverName, "upstream_error", `OAuth refresh failed: ${message}`);
    }
  }

  return stored.tokens.access_token;
}

export interface OAuthSecretNames {
  client: string;
  tokens: string;
  verifier: string;
  discovery: string;
}

export function oauthSecretNames(serverName: string): OAuthSecretNames {
  return {
    client: oauthSecretName(serverName, "client"),
    tokens: oauthSecretName(serverName, "tokens"),
    verifier: oauthSecretName(serverName, "verifier"),
    discovery: oauthSecretName(serverName, "discovery")
  };
}

/** Removes all stored OAuth credentials for a server. Returns the secret names actually removed. */
export function clearOAuthCredentials(serverName: string, secrets: SecretsManager): string[] {
  const removed: string[] = [];
  for (const name of Object.values(oauthSecretNames(serverName))) {
    if (secrets.getSecret(name) !== null) {
      secrets.removeSecret(name);
      removed.push(name);
    }
  }
  return removed;
}

export interface OAuthCredentialStatus {
  /** Whether the server's config currently binds an oauth:// reference to this server name. */
  bound: boolean;
  signedIn: boolean;
  obtainedAt?: number;
  expiresAt?: number;
  expired: boolean;
  hasRefreshToken: boolean;
  clientRegistered: boolean;
}

/** Purely local — no network calls. Safe to run offline and cheap enough for `auth status`. */
export function getOAuthCredentialStatus(
  serverName: string,
  spec: UpstreamServerSpec,
  secrets: SecretsManager
): OAuthCredentialStatus {
  const bound =
    spec.transport === "http" &&
    Object.values(spec.headers ?? {}).some((value) => isOAuthReference(value) && oauthReferenceServerName(value) === serverName);

  const clientInfo = readJsonSecret<OAuthClientInformationMixed>(secrets, oauthSecretName(serverName, "client"));
  const clientRegistered = clientInfo != null;

  const stored = readJsonSecret<StoredOAuthTokens>(secrets, oauthSecretName(serverName, "tokens"));
  if (!stored) {
    return { bound, signedIn: false, expired: false, hasRefreshToken: false, clientRegistered };
  }

  const expiresAt = stored.tokens.expires_in ? stored.obtainedAt + stored.tokens.expires_in * 1000 : undefined;
  const expired = expiresAt != null && Date.now() >= expiresAt;

  return {
    bound,
    signedIn: true,
    obtainedAt: stored.obtainedAt,
    expiresAt,
    expired,
    hasRefreshToken: Boolean(stored.tokens.refresh_token),
    clientRegistered
  };
}
