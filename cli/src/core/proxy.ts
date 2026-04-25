import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { SecretsManager } from "./secrets.js";
import { ensureGatewayToken } from "./registry.js";
import { getGatewayUrl } from "./sync.js";

export async function runStdioProxy(serverName: string): Promise<void> {
  const config = loadConfig();
  const secrets = new SecretsManager();
  const localToken = ensureGatewayToken(config, secrets);
  const gatewayUrl = getGatewayUrl(config);

  const upstreamUrl = new URL(`${gatewayUrl}?upstream=${encodeURIComponent(serverName)}`);

  const httpTransport = new StreamableHTTPClientTransport(upstreamUrl, {
    requestInit: {
      headers: { Authorization: `Bearer ${localToken}` }
    }
  });
  const stdioTransport = new StdioServerTransport();

  let closed = false;
  const shutdown = async (code = 0): Promise<void> => {
    if (closed) return;
    closed = true;
    try { await httpTransport.close(); } catch {}
    try { await stdioTransport.close(); } catch {}
    process.exit(code);
  };

  stdioTransport.onmessage = (msg: JSONRPCMessage) => {
    httpTransport.send(msg).catch((err: Error) => {
      process.stderr.write(`[mcpx proxy] gateway send failed: ${err.message}\n`);
    });
  };

  httpTransport.onmessage = (msg: JSONRPCMessage) => {
    stdioTransport.send(msg).catch((err: Error) => {
      process.stderr.write(`[mcpx proxy] stdio send failed: ${err.message}\n`);
    });
  };

  httpTransport.onerror = (err: Error) => {
    process.stderr.write(`[mcpx proxy] gateway error: ${err.message}\n`);
  };
  stdioTransport.onerror = (err: Error) => {
    process.stderr.write(`[mcpx proxy] stdio error: ${err.message}\n`);
  };

  httpTransport.onclose = () => { void shutdown(0); };
  stdioTransport.onclose = () => { void shutdown(0); };

  process.on("SIGTERM", () => { void shutdown(0); });
  process.on("SIGINT", () => { void shutdown(0); });

  await httpTransport.start();
  await stdioTransport.start();
}
