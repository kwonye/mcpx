import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { Server } from "@modelcontextprotocol/server";
import { loadConfig } from "./config.js";
import { SecretsManager } from "./secrets.js";
import { ensureGatewayToken } from "./registry.js";
import { getGatewayUrl } from "./sync.js";
import { getDaemonStatus, startDaemon } from "./daemon.js";
import { z } from "zod";
import { MCP_V2_PROTOCOL_VERSION, forwardedMcpParams } from "./mcp-v2.js";
import { APP_VERSION } from "../version.js";

export async function runStdioProxy(serverName: string): Promise<void> {
  const config = loadConfig();
  const secrets = new SecretsManager();
  const localToken = process.env.MCPX_PROXY_TOKEN ?? ensureGatewayToken(config, secrets);

  if (process.env.MCPX_SKIP_DAEMON_AUTOSTART !== "1") {
    const status = getDaemonStatus(config);
    if (!status.running) {
      const cliPath = process.argv[1] ?? "";
      await startDaemon(config, cliPath, secrets);
    }
  }

  const gatewayUrl = getGatewayUrl(loadConfig());
  const upstreamUrl = new URL(`${gatewayUrl}?upstream=${encodeURIComponent(serverName)}`);
  let activeClient: Client | undefined;
  let closed = false;

  const handle = serveStdio(
    async () => {
      const transport = new StreamableHTTPClientTransport(upstreamUrl, {
        requestInit: {
          headers: { Authorization: `Bearer ${localToken}` }
        }
      });
      const client = new Client(
        { name: "mcpx-proxy", version: APP_VERSION },
        { versionNegotiation: { mode: { pin: MCP_V2_PROTOCOL_VERSION } } }
      );
      activeClient = client;
      await client.connect(transport);

      const server = new Server(
        { name: "mcpx-proxy", version: APP_VERSION },
        {
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
            extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] }, "io.modelcontextprotocol/skills": {} }
          },
          supportedProtocolVersions: [MCP_V2_PROTOCOL_VERSION]
        }
      );

      server.setRequestHandler("tools/list", (request, context) => client.listTools(forwardedMcpParams(request.params, context) as never, { cacheMode: "bypass", allowInputRequired: true }));
      server.setRequestHandler("resources/list", (request, context) => client.listResources(forwardedMcpParams(request.params, context) as never, { cacheMode: "bypass", allowInputRequired: true }));
      server.setRequestHandler("prompts/list", (request, context) => client.listPrompts(forwardedMcpParams(request.params, context) as never, { cacheMode: "bypass", allowInputRequired: true }));
      server.setRequestHandler("tools/call", (request, context) => client.callTool(forwardedMcpParams(request.params, context) as never, { allowInputRequired: true }));
      server.setRequestHandler("resources/read", (request, context) => client.readResource(forwardedMcpParams(request.params, context) as never, { cacheMode: "bypass", allowInputRequired: true }));
      server.setRequestHandler("prompts/get", (request, context) => client.getPrompt(forwardedMcpParams(request.params, context) as never, { allowInputRequired: true }));

      for (const method of ["skills/list", "skills/get"] as const) {
        const skillResult = method === "skills/list" ? z.object({ skills: z.array(z.unknown()) }).passthrough() : z.object({ skill: z.unknown() }).passthrough();
        const params = method === "skills/get" ? z.object({ uri: z.string() }).passthrough() : z.object({ cursor: z.string().optional() }).passthrough();
        server.setRequestHandler(method, { params, result: skillResult }, (params, context) =>
          client.request({ method, params: forwardedMcpParams(params, context) }, skillResult));
      }

      return server;
    },
    {
      legacy: "reject",
      onerror: (error) => {
        process.stderr.write(`[mcpx proxy] ${error.message}\n`);
      }
    }
  );

  const shutdown = async (code = 0): Promise<void> => {
    if (closed) return;
    closed = true;
    try {
      await handle.close();
    } catch {
      // Ignore shutdown errors.
    }
    try {
      await activeClient?.close();
    } catch {
      // Ignore shutdown errors.
    }
    if (code !== 0) {
      process.exitCode = code;
    }
  };

  process.once("SIGTERM", () => { void shutdown(); });
  process.once("SIGINT", () => { void shutdown(); });
  process.stdin.once("close", () => { void shutdown(); });
}
