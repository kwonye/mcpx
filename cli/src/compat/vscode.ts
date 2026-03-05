/**
 * VS Code MCP compatibility layer.
 * 
 * Supports:
 * - code --add-mcp '<json>' with single-server JSON
 * - Fields: name, type, url, command, args, env, headers
 * 
 * Rejects:
 * - VS Code-only fields: sandbox, scope, container-specific config
 * - Multi-server JSON arrays
 * - Invalid JSON
 */

interface VSCodeParseResult {
  normalizedArgs: string[];
  error?: string;
}

interface VSCodeServerConfig {
  name?: string;
  type?: "http" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  // VS Code-only fields that we reject
  sandbox?: unknown;
  scope?: unknown;
  container?: unknown;
  [key: string]: unknown;
}

/**
 * VS Code-only fields that cannot be mapped to mcpx.
 */
const VS_CODE_ONLY_FIELDS = [
  "sandbox",
  "scope",
  "container",
  "containerId",
  "workspaceFolder",
  "lifecycle",
  "alwaysAllow",
  "disabled"
];

/**
 * Validates VS Code server config and rejects unsupported fields.
 */
function validateVSCodeConfig(config: VSCodeServerConfig): string | null {
  // Check for VS Code-only fields
  for (const field of VS_CODE_ONLY_FIELDS) {
    if (config[field] !== undefined) {
      return `VS Code field "${field}" is not supported. Use global \`mcpx add\` for advanced configuration.`;
    }
  }

  // Validate required fields
  if (!config.name) {
    return "VS Code config must include 'name' field.";
  }

  // Must have either url (HTTP) or command (stdio)
  if (!config.url && !config.command) {
    return "VS Code config must include either 'url' (HTTP) or 'command' (stdio) field.";
  }

  // Cannot have both url and command
  if (config.url && config.command) {
    return "VS Code config cannot have both 'url' and 'command'. Specify one transport type.";
  }

  // Validate type field if present
  if (config.type !== undefined && config.type !== "http" && config.type !== "stdio") {
    return `Invalid 'type' value: ${config.type}. Must be 'http' or 'stdio'.`;
  }

  // Validate env is a simple string map
  if (config.env !== undefined) {
    if (typeof config.env !== "object" || config.env === null || Array.isArray(config.env)) {
      return "'env' must be a key-value object.";
    }
    for (const [key, value] of Object.entries(config.env)) {
      if (typeof value !== "string") {
        return `'env["${key}"]' must be a string value.`;
      }
    }
  }

  // Validate headers is a simple string map
  if (config.headers !== undefined) {
    if (typeof config.headers !== "object" || config.headers === null || Array.isArray(config.headers)) {
      return "'headers' must be a key-value object.";
    }
    for (const [key, value] of Object.entries(config.headers)) {
      if (typeof value !== "string") {
        return `'headers["${key}"]' must be a string value.`;
      }
    }
  }

  // Validate args is an array of strings
  if (config.args !== undefined) {
    if (!Array.isArray(config.args)) {
      return "'args' must be an array.";
    }
    for (let i = 0; i < config.args.length; i++) {
      if (typeof config.args[i] !== "string") {
        return `'args[${i}]' must be a string.`;
      }
    }
  }

  return null;
}

/**
 * Normalizes VS Code JSON config to canonical mcpx add format.
 * 
 * VS Code HTTP: { name, url, headers? }
 * -> mcpx add <name> <url> --header "Key=Value"...
 * 
 * VS Code stdio: { name, command, args?, env? }
 * -> mcpx add <name> <command> [args...] --env KEY=VALUE...
 */
function normalizeVSCodeConfig(config: VSCodeServerConfig): string[] {
  const normalized: string[] = [config.name!];

  if (config.url) {
    // HTTP mode
    normalized.push(config.url);

    // Add headers
    if (config.headers) {
      for (const [key, value] of Object.entries(config.headers)) {
        normalized.push("--header", `${key}=${value}`);
      }
    }
  } else if (config.command) {
    // stdio mode
    normalized.push(config.command);

    // Add args
    if (config.args && config.args.length > 0) {
      normalized.push(...config.args);
    }

    // Add env vars
    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        normalized.push("--env", `${key}=${value}`);
      }
    }
  }

  return normalized;
}

/**
 * Parses VS Code --add-mcp JSON payload and normalizes to mcpx add format.
 */
export function parseVSCodeArgs(jsonPayload: string | undefined): VSCodeParseResult {
  if (!jsonPayload) {
    return {
      normalizedArgs: [],
      error: "Usage: mcpx code --add-mcp '<json>'"
    };
  }

  // Parse JSON
  let config: VSCodeServerConfig | VSCodeServerConfig[];
  try {
    config = JSON.parse(jsonPayload);
  } catch (parseError) {
    return {
      normalizedArgs: [],
      error: `Invalid JSON: ${(parseError as Error).message}`
    };
  }

  // Reject arrays - we only support single-server config
  if (Array.isArray(config)) {
    return {
      normalizedArgs: [],
      error: "Array of servers not supported. Use `mcpx add` for each server individually."
    };
  }

  // Validate config
  const validationError = validateVSCodeConfig(config);
  if (validationError) {
    return {
      normalizedArgs: [],
      error: validationError
    };
  }

  // Normalize to mcpx add format
  const normalized = normalizeVSCodeConfig(config);

  return { normalizedArgs: normalized };
}
