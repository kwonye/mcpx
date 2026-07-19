import fs from "node:fs";
import http from "node:http";
import { afterEach, describe, expect, it } from "bun:test";
import { getOAuthAccessToken, isOAuthReference, oauthReferenceServerName, runOAuthLogin } from "../src/core/oauth.js";
import type { OAuthCodeReceiver } from "../src/core/oauth.js";
import { SecretsManager } from "../src/core/secrets.js";
import { UpstreamError } from "../src/core/errors.js";
import type { HttpServerSpec } from "../src/types.js";
import { setupTempEnv } from "./helpers.js";

// Mirrors the private oauthSecretName() naming scheme in src/core/oauth.ts (not
// exported). Only ever called here with serverName values that are already
// lowercase and contain no characters that scheme would need to substitute.
function secretName(serverName: string, suffix: "client" | "tokens" | "verifier" | "discovery"): string {
  return `oauth_${serverName}_${suffix}`;
}

function seedClientSecret(secrets: SecretsManager, serverName: string, clientId = "test-client"): void {
  secrets.setSecret(secretName(serverName, "client"), JSON.stringify({ client_id: clientId }));
}

function seedTokensSecret(
  secrets: SecretsManager,
  serverName: string,
  tokens: { access_token: string; token_type: string; expires_in?: number; refresh_token?: string },
  obtainedAt: number
): void {
  secrets.setSecret(secretName(serverName, "tokens"), JSON.stringify({ tokens, obtainedAt }));
}

function seedDiscoverySecret(secrets: SecretsManager, serverName: string, authorizationServerUrl: string): void {
  secrets.setSecret(secretName(serverName, "discovery"), JSON.stringify({ authorizationServerUrl }));
}

interface StartedServer {
  server: http.Server;
  url: string;
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
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** Awaits `promise`, returning the rejection reason. Fails the test if it resolves. */
async function expectRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("Expected promise to reject, but it resolved.");
}

describe("isOAuthReference / oauthReferenceServerName", () => {
  it("recognizes oauth:// references and rejects everything else", () => {
    expect(isOAuthReference("oauth://my-server")).toBe(true);
    expect(isOAuthReference("secret://my-server")).toBe(false);
    expect(isOAuthReference("plain-value")).toBe(false);
    expect(isOAuthReference("")).toBe(false);
  });

  it("extracts and URL-decodes the server name from a reference", () => {
    expect(oauthReferenceServerName("oauth://my-server")).toBe("my-server");
    expect(oauthReferenceServerName("oauth://my%20server%2Fname")).toBe("my server/name");
  });

  it("throws when given a non-oauth reference", () => {
    expect(() => oauthReferenceServerName("secret://my-server")).toThrow('Not an OAuth reference: secret://my-server');
  });
});

describe("getOAuthAccessToken", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) await fn();
    }
  });

  it("returns the stored access token without making any network call when not expiring", async () => {
    const env = setupTempEnv("mcpx-oauth-");
    cleanups.push(env.restore);

    const secrets = new SecretsManager();
    const serverName = "test-server";
    seedTokensSecret(secrets, serverName, { access_token: "cached-access-token", token_type: "Bearer", expires_in: 3600, refresh_token: "r1" }, Date.now());

    // Port 1 is a reserved port that refuses connections; if getOAuthAccessToken
    // attempted any network I/O here the call would reject instead of resolving.
    const spec: HttpServerSpec = { transport: "http", url: "http://127.0.0.1:1/mcp" };
    const token = await getOAuthAccessToken(serverName, spec, secrets);

    expect(token).toBe("cached-access-token");
  });

  it("throws auth_required when no tokens are stored for the server", async () => {
    const env = setupTempEnv("mcpx-oauth-");
    cleanups.push(env.restore);

    const secrets = new SecretsManager();
    const spec: HttpServerSpec = { transport: "http", url: "http://127.0.0.1:1/mcp" };

    const err = await expectRejection(getOAuthAccessToken("test-server", spec, secrets));
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).code).toBe("auth_required");
  });

  it("returns the stale access token when expired but there is no refresh token and no forceRefresh", async () => {
    const env = setupTempEnv("mcpx-oauth-");
    cleanups.push(env.restore);

    const secrets = new SecretsManager();
    const serverName = "test-server";
    seedTokensSecret(secrets, serverName, { access_token: "stale-access-token", token_type: "Bearer", expires_in: 100 }, Date.now() - 1_000_000);

    const spec: HttpServerSpec = { transport: "http", url: "http://127.0.0.1:1/mcp" };
    const token = await getOAuthAccessToken(serverName, spec, secrets);

    expect(token).toBe("stale-access-token");
  });

  it("throws auth_expired when forceRefresh is requested and there is no refresh token", async () => {
    const env = setupTempEnv("mcpx-oauth-");
    cleanups.push(env.restore);

    const secrets = new SecretsManager();
    const serverName = "test-server";
    seedTokensSecret(secrets, serverName, { access_token: "stale-access-token", token_type: "Bearer", expires_in: 100 }, Date.now() - 1_000_000);

    const spec: HttpServerSpec = { transport: "http", url: "http://127.0.0.1:1/mcp" };
    const err = await expectRejection(getOAuthAccessToken(serverName, spec, secrets, { forceRefresh: true }));

    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).code).toBe("auth_expired");
  });

  it("throws auth_expired when the token is expired and no OAuth client info is stored", async () => {
    const env = setupTempEnv("mcpx-oauth-");
    cleanups.push(env.restore);

    const secrets = new SecretsManager();
    const serverName = "test-server";
    seedTokensSecret(secrets, serverName, { access_token: "old-access", token_type: "Bearer", expires_in: 100, refresh_token: "old-refresh" }, Date.now() - 1_000_000);
    // No "client" secret seeded.

    const spec: HttpServerSpec = { transport: "http", url: "http://127.0.0.1:1/mcp" };
    const err = await expectRejection(getOAuthAccessToken(serverName, spec, secrets));

    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).code).toBe("auth_expired");
  });

  it("refreshes an expired token against the discovered token endpoint and persists the result", async () => {
    const env = setupTempEnv("mcpx-oauth-");
    cleanups.push(env.restore);

    let tokenCalls = 0;
    const upstream = await startServer((req, res) => {
      if (req.method === "POST" && req.url === "/token") {
        tokenCalls++;
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ access_token: "new-access-token", token_type: "Bearer", expires_in: 3600, refresh_token: "new-refresh-token" }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    cleanups.push(() => closeServer(upstream.server));

    const secrets = new SecretsManager();
    const serverName = "test-server";
    seedClientSecret(secrets, serverName);
    seedTokensSecret(secrets, serverName, { access_token: "old-access-token", token_type: "Bearer", expires_in: 100, refresh_token: "old-refresh-token" }, Date.now() - 1_000_000);
    // Seed the discovery cache directly so getOAuthAccessToken skips RFC 9728/8414
    // discovery HTTP entirely and calls the token endpoint straight away.
    seedDiscoverySecret(secrets, serverName, upstream.url);

    const spec: HttpServerSpec = { transport: "http", url: `${upstream.url}/mcp` };
    const token = await getOAuthAccessToken(serverName, spec, secrets);

    expect(token).toBe("new-access-token");
    expect(tokenCalls).toBe(1);

    const persisted = JSON.parse(secrets.getSecret(secretName(serverName, "tokens"))!);
    expect(persisted.tokens.access_token).toBe("new-access-token");
    expect(persisted.tokens.refresh_token).toBe("new-refresh-token");
    expect(typeof persisted.obtainedAt).toBe("number");
  });

  it("classifies a spec-compliant invalid_grant refresh response as auth_expired", async () => {
    // getOAuthAccessToken's catch block special-cases "auth_expired" for
    // InvalidGrantError/InvalidClientError instances thrown by the SDK, in addition to
    // the /invalid_grant|invalid_client|4\d{2}/i message-text fallback. The SDK's
    // OAuthError for a well-formed `{error: "invalid_grant", error_description}`
    // response carries only the description in `.message` -- the literal string
    // "invalid_grant" never appears there -- so relying on the SDK error class (rather
    // than the message regex alone) is what makes this realistic response classify as
    // "auth_expired" instead of incorrectly falling through to "upstream_error".
    const env = setupTempEnv("mcpx-oauth-");
    cleanups.push(env.restore);

    const upstream = await startServer((req, res) => {
      if (req.method === "POST" && req.url === "/token") {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "invalid_grant", error_description: "The refresh token is invalid or expired" }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    cleanups.push(() => closeServer(upstream.server));

    const secrets = new SecretsManager();
    const serverName = "test-server";
    seedClientSecret(secrets, serverName);
    seedTokensSecret(secrets, serverName, { access_token: "old-access-token", token_type: "Bearer", expires_in: 100, refresh_token: "old-refresh-token" }, Date.now() - 1_000_000);
    seedDiscoverySecret(secrets, serverName, upstream.url);
    const tokensBefore = secrets.getSecret(secretName(serverName, "tokens"));

    const spec: HttpServerSpec = { transport: "http", url: `${upstream.url}/mcp` };
    const err = await expectRejection(getOAuthAccessToken(serverName, spec, secrets));

    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).code).toBe("auth_expired");
    expect((err as UpstreamError).message).toContain("The refresh token is invalid or expired");

    // Refresh failure must not disturb the existing stored tokens.
    expect(secrets.getSecret(secretName(serverName, "tokens"))).toBe(tokensBefore);
  });
});

describe("runOAuthLogin rollback", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) await fn();
    }
  });

  it("leaves no tokens behind and cleans up the code verifier when token exchange fails", async () => {
    const env = setupTempEnv("mcpx-oauth-");
    cleanups.push(env.restore);

    let tokenCalls = 0;
    const upstream = await startServer((req, res) => {
      if (req.method === "POST" && req.url === "/token") {
        tokenCalls++;
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "server_error", error_description: "token exchange boom" }));
        return;
      }
      // Discovery (and everything else) -> 404, so no metadata is found and the
      // flow falls back to unauthenticated defaults without a spec-complete server.
      res.statusCode = 404;
      res.end();
    });
    cleanups.push(() => closeServer(upstream.server));

    const secrets = new SecretsManager();
    const serverName = "test-server";
    // Pre-register the OAuth client so the login flow skips Dynamic Client
    // Registration (out of scope) and goes straight to the authorize/token legs.
    seedClientSecret(secrets, serverName);

    const spec: HttpServerSpec = { transport: "http", url: `${upstream.url}/mcp` };
    const openUrlCalls: string[] = [];
    const openUrl = async (url: string) => {
      openUrlCalls.push(url);
    };
    // Resolves (never rejects) so we don't hand runOAuthLogin a promise that could
    // reject before it is awaited -- the SDK's `auth()` call only awaits this
    // promise after the redirect step, and an early/unawaited rejection here
    // would surface as an unhandled promise rejection rather than a clean
    // try/catch inside runOAuthLogin.
    const codeReceiver: OAuthCodeReceiver = {
      redirectUrl: "http://127.0.0.1:9/callback",
      waitForCode: async () => "fake-authorization-code"
    };

    const configPath = `${env.root}/config/mcpx/config.json`;

    const err = await expectRejection(runOAuthLogin(serverName, spec, secrets, openUrl, configPath, codeReceiver));
    expect((err as Error).message).toContain("token exchange boom");

    expect(tokenCalls).toBe(1);
    expect(openUrlCalls.length).toBe(1);

    expect(secrets.getSecret(secretName(serverName, "tokens"))).toBeNull();
    expect(secrets.getSecret(secretName(serverName, "client"))).toBe(JSON.stringify({ client_id: "test-client" }));
    expect(secrets.getSecret(secretName(serverName, "verifier"))).toBeNull();
    // The config file is only written after a successful token exchange, so a
    // failure here must never create or touch it.
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it("restores pre-existing tokens untouched when a re-authentication attempt fails", async () => {
    const env = setupTempEnv("mcpx-oauth-");
    cleanups.push(env.restore);

    const upstream = await startServer((req, res) => {
      if (req.method === "POST" && req.url === "/token") {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "server_error", error_description: "token exchange boom" }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    cleanups.push(() => closeServer(upstream.server));

    const secrets = new SecretsManager();
    const serverName = "test-server";
    seedClientSecret(secrets, serverName);
    // A working, already-authorized server re-running login (e.g. to pick up new
    // scopes) must not lose its existing credentials if the new attempt fails.
    const originalTokensJson = JSON.stringify({
      tokens: { access_token: "old-access-token", token_type: "Bearer", expires_in: 100, refresh_token: "old-refresh-token" },
      obtainedAt: 12345
    });
    secrets.setSecret(secretName(serverName, "tokens"), originalTokensJson);

    const spec: HttpServerSpec = { transport: "http", url: `${upstream.url}/mcp` };
    const openUrl = async () => {};
    const codeReceiver: OAuthCodeReceiver = {
      redirectUrl: "http://127.0.0.1:9/callback",
      waitForCode: async () => "fake-authorization-code"
    };
    const configPath = `${env.root}/config/mcpx/config.json`;

    await expectRejection(runOAuthLogin(serverName, spec, secrets, openUrl, configPath, codeReceiver));

    expect(secrets.getSecret(secretName(serverName, "tokens"))).toBe(originalTokensJson);
    expect(secrets.getSecret(secretName(serverName, "client"))).toBe(JSON.stringify({ client_id: "test-client" }));
    expect(secrets.getSecret(secretName(serverName, "verifier"))).toBeNull();
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it("rejects gracefully instead of crashing with an unhandled rejection when codeReceiver rejects before the first auth round-trip completes", async () => {
    // codePromise = codeReceiver.waitForCode(state) is created before runOAuthLogin's
    // first `await auth(...)` round-trip. If that first round-trip fails (as it does
    // here, via a failed Dynamic Client Registration) before codePromise is ever
    // awaited, and codePromise has already rejected by then, the rejection used to be
    // left unhandled -- crashing the process rather than surfacing as a normal
    // rejection from runOAuthLogin. If this test's process survives to the assertion
    // below, the fix is working; before the fix this test run would die instead.
    const env = setupTempEnv("mcpx-oauth-");
    cleanups.push(env.restore);

    // Everything 404s: discovery finds no metadata and, because no client secret is
    // seeded below, the ensuing Dynamic Client Registration POST to /register also
    // 404s -- so the *first* auth() call inside runOAuthLogin rejects before
    // `await codePromise` is ever reached.
    const upstream = await startServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    cleanups.push(() => closeServer(upstream.server));

    const secrets = new SecretsManager();
    const serverName = "test-server";
    // Deliberately no seedClientSecret() call: forces Dynamic Client Registration,
    // which fails against the all-404 upstream above.

    const spec: HttpServerSpec = { transport: "http", url: `${upstream.url}/mcp` };
    const openUrl = async () => {};
    // Rejects immediately -- before runOAuthLogin ever reaches `await codePromise`.
    const codeReceiver: OAuthCodeReceiver = {
      redirectUrl: "http://127.0.0.1:9/callback",
      waitForCode: () => Promise.reject(new Error("code receiver boom"))
    };
    const configPath = `${env.root}/config/mcpx/config.json`;

    const err = await expectRejection(runOAuthLogin(serverName, spec, secrets, openUrl, configPath, codeReceiver));

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("404");
  });
});
