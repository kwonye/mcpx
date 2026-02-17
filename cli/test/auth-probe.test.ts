import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { probeHttpAuthRequirement } from "../src/core/auth-probe.js";
import { SecretsManager } from "../src/core/secrets.js";

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

describe("http auth probe", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) {
        await fn();
      }
    }
  });

  it("detects auth requirement on 401 challenge", async () => {
    const upstream = await startServer((_req, res) => {
      res.statusCode = 401;
      res.setHeader("www-authenticate", 'Bearer error="invalid_token"');
      res.end(JSON.stringify({ error: "invalid_token" }));
    });
    cleanups.push(() => closeServer(upstream.server));

    const probe = await probeHttpAuthRequirement(
      {
        transport: "http",
        url: `http://127.0.0.1:${upstream.port}/mcp`
      },
      new SecretsManager()
    );

    expect(probe.authRequired).toBe(true);
    expect(probe.status).toBe(401);
    expect(probe.wwwAuthenticate).toContain("invalid_token");
  });

  it("does not report auth requirement when request succeeds", async () => {
    const upstream = await startServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }

      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { id: string | number | null };
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { tools: [] } }));
    });
    cleanups.push(() => closeServer(upstream.server));

    const probe = await probeHttpAuthRequirement(
      {
        transport: "http",
        url: `http://127.0.0.1:${upstream.port}/mcp`
      },
      new SecretsManager()
    );

    expect(probe.authRequired).toBe(false);
    expect(probe.status).toBe(200);
  });

  it("respects existing Authorization header values", async () => {
    const upstream = await startServer(async (req, res) => {
      if (req.headers.authorization !== "Bearer good-token") {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: "missing_token" }));
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }

      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { id: string | number | null };
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { tools: [] } }));
    });
    cleanups.push(() => closeServer(upstream.server));

    const probe = await probeHttpAuthRequirement(
      {
        transport: "http",
        url: `http://127.0.0.1:${upstream.port}/mcp`,
        headers: {
          Authorization: "Bearer good-token"
        }
      },
      new SecretsManager()
    );

    expect(probe.authRequired).toBe(false);
    expect(probe.status).toBe(200);
  });
});
