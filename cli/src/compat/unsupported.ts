/**
 * Unsupported client detection.
 * 
 * Detects client-native patterns that are not supported in compatibility mode
 * and provides helpful guidance to use `mcpx add` instead.
 * 
 * Unsupported clients:
 * - cursor-agent (Cursor uses different MCP management)
 * - cline (Cline uses config-based setup)
 * - kiro (Kiro uses one-click/config-based setup)
 * - opencode (OpenCode uses generic mcpx add)
 */

interface UnsupportedClientResult {
  client: string;
  error: string;
}

/**
 * Map of unsupported client names to their guidance messages.
 */
const UNSUPPORTED_CLIENTS: Record<string, string> = {
  "cursor-agent": "Cursor MCP management uses a different interface. Use `mcpx add <name> <url|command>` directly to add MCP servers to mcpx.",
  "cline": "Cline uses config-based MCP setup. Use `mcpx add <name> <url|command>` to add servers to mcpx, then sync to Cline.",
  "kiro": "Kiro uses one-click/config-based MCP setup. Use `mcpx add <name> <url|command>` to add servers to mcpx, then sync to Kiro.",
  "opencode": "OpenCode uses generic mcpx integration. Use `mcpx add <name> <url|command>` to add servers directly."
};

/**
 * List of unsupported client prefixes to detect.
 */
const UNSUPPORTED_PREFIXES = Object.keys(UNSUPPORTED_CLIENTS);

/**
 * Detects if argv matches an unsupported client pattern.
 * 
 * @param argv - The command-line arguments
 * @returns Unsupported client info if detected, null otherwise
 */
export function detectUnsupportedClient(argv: string[]): UnsupportedClientResult | null {
  if (argv.length === 0) {
    return null;
  }

  const firstArg = argv[0];

  for (const prefix of UNSUPPORTED_PREFIXES) {
    if (firstArg === prefix || firstArg.startsWith(`${prefix}-`) || firstArg.startsWith(`${prefix}_`)) {
      return {
        client: firstArg,
        error: `${UNSUPPORTED_CLIENTS[prefix]}\n\nExample: mcpx add my-server https://example.com/mcp`
      };
    }
  }

  return null;
}
