import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import type { McpxConfig } from "../types.js";
import { SecretsManager } from "./secrets.js";
import { MCP_V2_PROTOCOL_VERSION } from "./mcp-v2.js";
import { APP_VERSION } from "../version.js";
import { buildEnrichedPath } from "./spawn-env.js";
import { getOAuthAccessToken } from "./oauth.js";

/** Only discovery/list operations are used before retiring native registrations. */
export async function verifyUpstreams(config: McpxConfig, names: string[]): Promise<void> {
  const secrets = new SecretsManager();
  for (const name of [...new Set(names)]) {
    const spec = config.servers[name];
    if (!spec || spec.enabled === false) continue;
    const client = new Client({ name: "mcpx-adoption-check", version: APP_VERSION }, { versionNegotiation: { mode: { pin: MCP_V2_PROTOCOL_VERSION } } });
    const signal = AbortSignal.timeout(10000);
    try {
      let transport: StdioClientTransport | StreamableHTTPClientTransport;
      if (spec.transport === "stdio") {
        const env: Record<string, string> = { ...getDefaultEnvironment(), PATH: buildEnrichedPath(process.env.PATH) };
        for (const [key, value] of Object.entries(spec.env ?? {})) env[key] = secrets.resolveMaybeSecret(value);
        transport = new StdioClientTransport({ command: spec.command, args: spec.args, cwd: spec.cwd, env });
      } else {
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(spec.headers ?? {})) headers[key] = value.startsWith("oauth://") ? `Bearer ${await getOAuthAccessToken(value.slice(8), spec, secrets)}` : secrets.resolveMaybeSecret(value);
        transport = new StreamableHTTPClientTransport(new URL(spec.url), { requestInit: { headers } });
      }
      await client.connect(transport, { signal, timeout: 10000 });
      const capabilities = client.getServerCapabilities();
      if (capabilities?.tools) await client.listTools({}, { signal, timeout: 10000 });
      else if (capabilities?.resources) await client.listResources({}, { signal, timeout: 10000 });
      else if (capabilities?.prompts) await client.listPrompts({}, { signal, timeout: 10000 });
    } catch { throw new Error(`Could not verify managed upstream "${name}". The native installation was preserved; configure its credentials or connection and scan again.`); }
    finally { await client.close().catch(() => undefined); }
  }
}
