import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { probeOAuthSupport, __resetOAuthSupportCache } from "../src/core/oauth.js";
import { probeHttpAuthRequirement } from "../src/core/auth-probe.js";
import { SecretsManager } from "../src/core/secrets.js";

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
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

describe("probeOAuthSupport", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  beforeEach(() => {
    __resetOAuthSupportCache();
  });

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) {
        await fn();
      }
    }
  });

  it("reports supported when RFC 9728 protected-resource metadata is served", async () => {
    const upstream = await startServer((req, res) => {
      if (req.url === "/.well-known/oauth-protected-resource") {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ resource: "http://127.0.0.1/mcp", authorization_servers: ["http://127.0.0.1/as"] }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    cleanups.push(() => closeServer(upstream.server));

    const probe = await probeOAuthSupport(`${upstream.url}/mcp`);

    expect(probe.support).toBe("supported");
    expect(probe.resourceMetadata).toBe(true);
  });

  it("reports supported from RFC 8414 authorization-server metadata alone (no RFC 9728)", async () => {
    const upstream = await startServer((req, res) => {
      if (req.url === "/.well-known/oauth-protected-resource") {
        res.statusCode = 404;
        res.end();
        return;
      }
      if (req.url === "/.well-known/oauth-authorization-server") {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            issuer: upstream.url,
            authorization_endpoint: `${upstream.url}/authorize`,
            token_endpoint: `${upstream.url}/token`,
            response_types_supported: ["code"]
          })
        );
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    cleanups.push(() => closeServer(upstream.server));

    const probe = await probeOAuthSupport(`${upstream.url}/mcp`);

    expect(probe.support).toBe("supported");
    expect(probe.authorizationServerMetadata).toBe(true);
    expect(probe.resourceMetadata).toBe(false);
  });

  it("reports unsupported when every well-known endpoint 404s", async () => {
    const upstream = await startServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    cleanups.push(() => closeServer(upstream.server));

    const probe = await probeOAuthSupport(`${upstream.url}/mcp`);

    expect(probe.support).toBe("unsupported");
  });

  it("reports unknown (not unsupported) when the server is unreachable", async () => {
    const probe = await probeOAuthSupport("http://127.0.0.1:1/mcp", { timeoutMs: 500 });

    expect(probe.support).toBe("unknown");
    expect(probe.error).toBeTruthy();
  });

  it("caches a positive result and does not re-probe within the TTL", async () => {
    let requestCount = 0;
    const upstream = await startServer((req, res) => {
      requestCount += 1;
      if (req.url === "/.well-known/oauth-protected-resource") {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ resource: "http://127.0.0.1/mcp" }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    cleanups.push(() => closeServer(upstream.server));

    const first = await probeOAuthSupport(`${upstream.url}/mcp`);
    const countAfterFirst = requestCount;
    const second = await probeOAuthSupport(`${upstream.url}/mcp`);

    expect(first.support).toBe("supported");
    expect(second.support).toBe("supported");
    expect(requestCount).toBe(countAfterFirst);
  });

  it("force option bypasses the cache", async () => {
    let requestCount = 0;
    const upstream = await startServer((_req, res) => {
      requestCount += 1;
      res.statusCode = 404;
      res.end();
    });
    cleanups.push(() => closeServer(upstream.server));

    await probeOAuthSupport(`${upstream.url}/mcp`);
    const countAfterFirst = requestCount;
    await probeOAuthSupport(`${upstream.url}/mcp`, { force: true });

    expect(requestCount).toBeGreaterThan(countAfterFirst);
  });
});

describe("probeHttpAuthRequirement + OAuth discovery", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  beforeEach(() => {
    __resetOAuthSupportCache();
  });

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) {
        await fn();
      }
    }
  });

  it("sets oauthLikely on a bare 401 with no WWW-Authenticate when discovery finds OAuth support", async () => {
    // Regression test: this is the exact scenario reported as "asks for a token
    // instead of opening an OAuth flow" — a 401 with no WWW-Authenticate header
    // must still surface the browser sign-in option when the server actually
    // supports OAuth per RFC 9728/8414 discovery.
    const upstream = await startServer((req, res) => {
      if (req.url === "/.well-known/oauth-protected-resource") {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ resource: "http://127.0.0.1/mcp" }));
        return;
      }
      if (req.url === "/mcp") {
        res.statusCode = 401;
        // Deliberately no www-authenticate header.
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    cleanups.push(() => closeServer(upstream.server));

    const probe = await probeHttpAuthRequirement(
      { transport: "http", url: `${upstream.url}/mcp` },
      new SecretsManager()
    );

    expect(probe.authRequired).toBe(true);
    expect(probe.wwwAuthenticate).toBeUndefined();
    expect(probe.oauthSupport).toBe("supported");
    expect(probe.oauthLikely).toBe(true);
  });

  it("leaves oauthLikely false on a bare 401 when discovery finds no OAuth metadata", async () => {
    const upstream = await startServer((req, res) => {
      if (req.url === "/mcp") {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    cleanups.push(() => closeServer(upstream.server));

    const probe = await probeHttpAuthRequirement(
      { transport: "http", url: `${upstream.url}/mcp` },
      new SecretsManager()
    );

    expect(probe.authRequired).toBe(true);
    expect(probe.oauthSupport).toBe("unsupported");
    expect(probe.oauthLikely).toBe(false);
  });

  it("sets oauthSupport on the HTTP-200 JSON-RPC auth-error branch", async () => {
    const upstream = await startServer((req, res) => {
      if (req.url === "/.well-known/oauth-protected-resource") {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ resource: "http://127.0.0.1/mcp" }));
        return;
      }
      if (req.url === "/mcp") {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: "1", error: { code: -32000, message: "unauthorized" } }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    cleanups.push(() => closeServer(upstream.server));

    const probe = await probeHttpAuthRequirement(
      { transport: "http", url: `${upstream.url}/mcp` },
      new SecretsManager()
    );

    expect(probe.authRequired).toBe(true);
    expect(probe.oauthSupport).toBe("supported");
    expect(probe.oauthLikely).toBe(true);
  });

  it("skips discovery entirely when discoverOAuth is false", async () => {
    let wellKnownHit = false;
    const upstream = await startServer((req, res) => {
      if (req.url?.startsWith("/.well-known/")) {
        wellKnownHit = true;
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ resource: "http://127.0.0.1/mcp" }));
        return;
      }
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "unauthorized" }));
    });
    cleanups.push(() => closeServer(upstream.server));

    const probe = await probeHttpAuthRequirement(
      { transport: "http", url: `${upstream.url}/mcp` },
      new SecretsManager(),
      8000,
      { discoverOAuth: false }
    );

    expect(probe.authRequired).toBe(true);
    expect(probe.oauthSupport).toBeUndefined();
    expect(wellKnownHit).toBe(false);
  });
});
