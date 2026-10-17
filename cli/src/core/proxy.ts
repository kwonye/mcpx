import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { Server } from "@modelcontextprotocol/server";
import { loadConfig } from "./config.js";
import { SecretsManager } from "./secrets.js";
import { ensureGatewayToken } from "./registry.js";
import { getGatewayUrl } from "./sync.js";
import { getDaemonStatus, startDaemon } from "./daemon.js";
import { MCP_V2_PROTOCOL_VERSION } from "./mcp-v2.js";
import { APP_VERSION } from "../version.js";

export async function runStdioProxy(serverName: string): Promise<void> {
  const config = loadConfig();
  const secrets = new SecretsManager();
  const localToken = ensureGatewayToken(config, secrets);
  const gatewayUrl = getGatewayUrl(config);

  if (process.env.MCPX_SKIP_DAEMON_AUTOSTART !== "1") {
    const status = getDaemonStatus(config);
    if (!status.running) {
      const cliPath = process.argv[1] ?? "";
      await startDaemon(config, cliPath, secrets);
    }
  }

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
            prompts: {}
          },
          supportedProtocolVersions: [MCP_V2_PROTOCOL_VERSION]
        }
      );

      server.setRequestHandler("tools/list", (request) => client.listTools(request.params));
      server.setRequestHandler("resources/list", (request) => client.listResources(request.params));
      server.setRequestHandler("prompts/list", (request) => client.listPrompts(request.params));
      server.setRequestHandler("tools/call", (request) => client.callTool(request.params));
      server.setRequestHandler("resources/read", (request) => client.readResource(request.params));
      server.setRequestHandler("prompts/get", (request) => client.getPrompt(request.params));

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
