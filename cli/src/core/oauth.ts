import http from "node:http";
import crypto from "node:crypto";
import {
  auth,
  discoverOAuthServerInfo,
  refreshAuthorization,
  type OAuthClientProvider,
  type OAuthDiscoveryState
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { HttpServerSpec, McpxConfig } from "../types.js";
import { loadConfig, saveConfig } from "./config.js";
import { SecretsManager } from "./secrets.js";
import { syncAllClients, persistSyncState } from "./sync.js";
import { UpstreamError } from "./errors.js";

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

function waitForAuthorizationCode(server: http.Server, expectedState: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`OAuth login timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    server.on("request", (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      response.setHeader("content-type", "text/html; charset=utf-8");

      if (error) {
        response.statusCode = 400;
        response.end("<html><body><h1>mcpx OAuth failed</h1><p>You can close this window.</p></body></html>");
        clearTimeout(timeout);
        reject(new Error(`OAuth authorization failed: ${error}`));
        return;
      }

      if (!code) {
        response.statusCode = 400;
        response.end("<html><body><h1>Missing OAuth code</h1><p>You can close this window.</p></body></html>");
        return;
      }

      if (state !== expectedState) {
        response.statusCode = 400;
        response.end("<html><body><h1>OAuth state mismatch</h1><p>You can close this window.</p></body></html>");
        clearTimeout(timeout);
        reject(new Error("OAuth state mismatch."));
        return;
      }

      response.end("<html><body><h1>mcpx OAuth complete</h1><p>You can close this window.</p></body></html>");
      clearTimeout(timeout);
      resolve(code);
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

export async function runOAuthLogin(
  serverName: string,
  spec: HttpServerSpec,
  secrets: SecretsManager,
  openUrl: (url: string) => void | Promise<void>,
  configPath?: string,
  codeReceiver?: OAuthCodeReceiver
): Promise<{ serverName: string; authorized: true }> {
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
    codePromise = codeReceiver.waitForCode(state);
  } else {
    callbackServer = http.createServer();
    const port = await listen(callbackServer);
    redirectUrl = `http://127.0.0.1:${port}/callback`;
    codePromise = waitForAuthorizationCode(callbackServer, state);
  }

  const provider = new InteractiveOAuthProvider(serverName, secrets, redirectUrl, state, openUrl);

  try {
    const initial = await auth(provider, {
      serverUrl: spec.url
    });
    if (initial !== "REDIRECT") {
      throw new Error(`Expected OAuth redirect for "${serverName}", got ${initial}.`);
    }

    const authorizationCode = await codePromise;

    const result = await auth(provider, {
      serverUrl: spec.url,
      authorizationCode
    });
    if (result !== "AUTHORIZED") {
      throw new Error(`OAuth login did not authorize "${serverName}".`);
    }

    const config = loadConfig(configPath);
    bindOAuthReference(config, serverName);
    saveConfig(config, configPath);
    const summary = syncAllClients(config, secrets);
    persistSyncState(summary, config);
    saveConfig(config, configPath);
    return { serverName, authorized: true };
  } catch (error) {
    // Restore tokens on failure so working credentials are never destroyed
    if (backupTokens) secrets.setSecret(oauthName, backupTokens);
    if (backupClient) secrets.setSecret(clientName, backupClient);
    throw error;
  } finally {
    if (callbackServer) {
      await closeServer(callbackServer);
    }
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
      // Token endpoint 4xx / invalid_grant / invalid_client → auth_expired (keep tokens)
      if (/invalid_grant|invalid_client|4\d{2}/i.test(message)) {
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
