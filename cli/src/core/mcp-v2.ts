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

/** Restore wire fields lifted into the SDK request context before forwarding. */
export function forwardedMcpParams(params: Record<string, unknown> | undefined, context: {
  mcpReq: { _meta?: Record<string, unknown>; envelope?: object; inputResponses?: Record<string, unknown>; requestState: () => unknown };
}): Record<string, unknown> {
  const state = context.mcpReq.requestState();
  return {
    ...params,
    _meta: { ...context.mcpReq._meta, ...context.mcpReq.envelope },
    ...(context.mcpReq.inputResponses ? { inputResponses: context.mcpReq.inputResponses } : {}),
    ...(typeof state === "string" ? { requestState: state } : {}),
  };
}
