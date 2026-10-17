export const MCP_V2_PROTOCOL_VERSION = "2026-07-28";
export const MCPX_MCP_CLIENT_INFO = { name: "mcpx", version: "2.0.0" } as const;

export function mcpV2Meta(clientInfo: { name: string; version: string } = MCPX_MCP_CLIENT_INFO): Record<string, unknown> {
  return {
    "io.modelcontextprotocol/protocolVersion": MCP_V2_PROTOCOL_VERSION,
    "io.modelcontextprotocol/clientInfo": clientInfo,
    "io.modelcontextprotocol/clientCapabilities": {}
  };
}

export function mcpV2Headers(method: string, headers: Record<string, string> = {}): Record<string, string> {
  return {
    ...headers,
    "mcp-protocol-version": MCP_V2_PROTOCOL_VERSION,
    "mcp-method": method
  };
}
