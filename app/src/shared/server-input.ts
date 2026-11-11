/**
 * Pure helpers for the "Add server" smart input. Shared so the main process
 * (which classifies input) and tests can use the same rules.
 */

/** Prefixes that mean "this is another tool's add command" - parsed by core. */
export const CLIENT_ADD_PREFIXES = [
  "mcpx add",
  "claude mcp add",
  "codex mcp add",
  "qwen mcp add",
  "openclaw mcp add",
  "hermes mcp add",
  "code --add-mcp"
] as const;

export function isClientAddCommand(input: string): boolean {
  const normalized = input.trim().replace(/\s+/g, " ");
  return CLIENT_ADD_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix} `));
}

export function looksLikeUrl(input: string): boolean {
  return /^https?:\/\/\S+$/i.test(input.trim());
}

const NAME_NOISE = /^(mcp|server|mcp-server|server-mcp)$/;

export function sanitizeServerName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 48);
}

/** "https://mcp.linear.app/sse" -> "linear"; "http://localhost:3000/mcp" -> "localhost". */
export function suggestNameFromUrl(url: string): string {
  try {
    const host = new URL(url.trim()).hostname;
    const labels = host.split(".").filter((label) => !/^(www|mcp|api|app)$/.test(label));
    const meaningful = labels.length > 1 ? labels[labels.length - 2] : labels[0] ?? host;
    return sanitizeServerName(meaningful) || "server";
  } catch {
    return "server";
  }
}

/**
 * Picks the most descriptive token of a launch command:
 * "npx -y @modelcontextprotocol/server-filesystem ~/src" -> "filesystem".
 */
export function suggestNameFromCommand(tokens: string[]): string {
  const candidates = tokens.filter((token) => !token.startsWith("-") && !/^(npx|uvx|bunx|pnpm|dlx|node|python3?|deno|run|docker|-y)$/.test(token));
  const pkg = candidates.find((token) => /[a-z]/i.test(token) && !token.includes("=") && !token.startsWith("~") && !token.startsWith("/") && !token.startsWith("."))
    ?? candidates[0]
    ?? tokens[0]
    ?? "server";
  const base = pkg.split("/").pop() || pkg;
  const stripped = base
    .replace(/@.*$/, "")
    .replace(/\.(js|ts|py)$/, "")
    .replace(/^(mcp-server-|server-|mcp-)/, "")
    .replace(/(-mcp-server|-mcp|-server)$/, "");
  const name = sanitizeServerName(NAME_NOISE.test(stripped) ? base : stripped);
  return name || "server";
}
