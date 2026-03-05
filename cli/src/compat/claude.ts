/**
 * Claude Code MCP compatibility layer.
 * 
 * Supports:
 * - HTTP add: claude mcp add <name> <url> [--header "Name: Value"]...
 * - stdio add: claude mcp add <name> --env KEY=VALUE -- <command> [args...]
 * 
 * Rejects:
 * - --transport sse
 * - --scope
 * - JSON import
 * - Desktop import
 */

interface ClaudeParseResult {
  normalizedArgs: string[];
  error?: string;
}

interface ParsedClaudeFlags {
  headers: string[];
  envVars: string[];
  hasScope: boolean;
  hasTransportSSE: boolean;
  hasJsonInput: boolean;
  hasDesktopImport: boolean;
}

/**
 * Parses Claude-style flags from argv, handling permissive option ordering.
 * Flags before the `--` separator are extracted.
 */
function parseClaudeFlags(argv: string[]): ParsedClaudeFlags {
  const headers: string[] = [];
  const envVars: string[] = [];
  let hasScope = false;
  let hasTransportSSE = false;
  let hasJsonInput = false;
  let hasDesktopImport = false;

  // Find the `--` separator position (if any)
  const separatorIndex = argv.indexOf("--");
  const flagRegion = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);

  for (let i = 0; i < flagRegion.length; i++) {
    const arg = flagRegion[i];

    if (arg === "--header" || arg === "-H") {
      const value = flagRegion[i + 1];
      if (value && !value.startsWith("-")) {
        headers.push(value);
        i++; // Skip the value
      } else {
        // Header without value - will be caught by validation
        headers.push("");
      }
    } else if (arg === "--env" || arg === "-e") {
      const value = flagRegion[i + 1];
      if (value && !value.startsWith("-")) {
        envVars.push(value);
        i++; // Skip the value
      } else {
        // Env without value - will be caught by validation
        envVars.push("");
      }
    } else if (arg === "--scope") {
      hasScope = true;
    } else if (arg === "--transport") {
      const value = flagRegion[i + 1];
      if (value && value.toLowerCase() === "sse") {
        hasTransportSSE = true;
      }
      i++; // Skip the value
    } else if (arg === "--" || arg.startsWith("-")) {
      // Other flags - ignore for now, they'll be handled by positional parsing
    }
  }

  // Check for JSON input (piped JSON or --json flag)
  hasJsonInput = argv.some((arg) => arg === "--json" || arg.startsWith("{"));

  // Check for desktop import patterns
  hasDesktopImport = argv.some(
    (arg) => arg === "--from-desktop" || arg.includes("claude_desktop_config")
  );

  return {
    headers,
    envVars,
    hasScope,
    hasTransportSSE,
    hasJsonInput,
    hasDesktopImport
  };
}

/**
 * Extracts positional arguments (name, url/command, args) from Claude argv.
 * Handles permissive option ordering by filtering out known flags.
 */
function extractPositionalArgs(argv: string[]): string[] {
  const separatorIndex = argv.indexOf("--");
  
  if (separatorIndex === -1) {
    // No separator - extract non-flag arguments
    const positional: string[] = [];
    let skipNext = false;

    for (let i = 0; i < argv.length; i++) {
      if (skipNext) {
        skipNext = false;
        continue;
      }

      const arg = argv[i];

      // Skip known flags and their values
      if (arg === "--header" || arg === "-H" || arg === "--env" || arg === "-e" || arg === "--transport" || arg === "--scope") {
        skipNext = true;
        continue;
      }

      // Skip other flags
      if (arg.startsWith("-")) {
        continue;
      }

      positional.push(arg);
    }

    return positional;
  } else {
    // With separator - everything before is flags/positionals, everything after is command args
    const beforeSeparator = argv.slice(0, separatorIndex);
    const afterSeparator = argv.slice(separatorIndex + 1);

    // Extract positionals from before separator
    const positional: string[] = [];
    let skipNext = false;

    for (let i = 0; i < beforeSeparator.length; i++) {
      if (skipNext) {
        skipNext = false;
        continue;
      }

      const arg = beforeSeparator[i];

      if (arg === "--header" || arg === "-H" || arg === "--env" || arg === "-e" || arg === "--transport" || arg === "--scope") {
        skipNext = true;
        continue;
      }

      if (arg.startsWith("-")) {
        continue;
      }

      positional.push(arg);
    }

    // Combine with command args after separator
    return [...positional, "--", ...afterSeparator];
  }
}

/**
 * Validates Claude arguments and rejects unsupported features.
 */
function validateClaudeArgs(flags: ParsedClaudeFlags): string | null {
  if (flags.hasScope) {
    return "Claude --scope is not supported. Use global `mcpx add` for project-wide servers.";
  }

  if (flags.hasTransportSSE) {
    return "Claude --transport sse is not supported. Use `mcpx add <name> <url>` for HTTP/SSE servers.";
  }

  if (flags.hasJsonInput) {
    return "Claude JSON import is not supported. Use `mcpx add` directly or `mcpx code --add-mcp '<json>'` for VS Code format.";
  }

  if (flags.hasDesktopImport) {
    return "Claude desktop config import is not supported. Use `mcpx add` to add servers individually.";
  }

  return null;
}

/**
 * Normalizes Claude args to canonical mcpx add format.
 * 
 * Claude HTTP: claude mcp add <name> <url> [--header "Name: Value"]...
 * -> mcpx add <name> <url> --header "Name=Value"...
 * 
 * Claude stdio: claude mcp add <name> --env KEY=VALUE -- <command> [args...]
 * -> mcpx add <name> <command> [args...] --env KEY=VALUE...
 */
export function parseClaudeArgs(argv: string[]): ClaudeParseResult {
  if (argv.length === 0) {
    return {
      normalizedArgs: [],
      error: "Usage: mcpx claude mcp add <name> <url|command> [options...]"
    };
  }

  // Parse flags
  const flags = parseClaudeFlags(argv);

  // Validate - reject unsupported features
  const validationError = validateClaudeArgs(flags);
  if (validationError) {
    return {
      normalizedArgs: [],
      error: validationError
    };
  }

  // Convert Claude-style headers (Name: Value) to mcpx format (Name=Value)
  const convertedHeaders = flags.headers.map((header) => {
    // Claude uses "Name: Value" format, convert to "Name=Value"
    const colonIndex = header.indexOf(":");
    if (colonIndex > 0) {
      const key = header.slice(0, colonIndex).trim();
      const value = header.slice(colonIndex + 1).trim();
      return `${key}=${value}`;
    }
    return header;
  });

  // Extract positional arguments
  const positional = extractPositionalArgs(argv);

  // Check for stdio separator
  const separatorIndex = positional.indexOf("--");
  
  if (separatorIndex === -1) {
    // HTTP mode: <name> <url>
    if (positional.length < 2) {
      return {
        normalizedArgs: [],
        error: "HTTP mode requires: claude mcp add <name> <url>"
      };
    }

    const [name, url, ...rest] = positional;

    // Build normalized args for HTTP
    const normalized: string[] = [name!, url!];

    // Add headers (converted from Name: Value to Name=Value)
    for (const header of convertedHeaders) {
      normalized.push("--header", header);
    }

    // Add any remaining positionals as args (unusual for HTTP but allow it)
    if (rest.length > 0) {
      normalized.push(...rest);
    }

    return { normalizedArgs: normalized };
  } else {
    // stdio mode: <name> -- <command> [args...]
    const beforeSeparator = positional.slice(0, separatorIndex);
    const afterSeparator = positional.slice(separatorIndex + 1);

    if (beforeSeparator.length < 1) {
      return {
        normalizedArgs: [],
        error: "stdio mode requires: claude mcp add <name> -- <command> [args...]"
      };
    }

    if (afterSeparator.length === 0) {
      return {
        normalizedArgs: [],
        error: "stdio mode requires a command after `--`: claude mcp add <name> -- <command> [args...]"
      };
    }

    const name = beforeSeparator[0];

    // Build normalized args for stdio
    // mcpx add <name> <command> [args...] --env KEY=VALUE...
    const normalized: string[] = [name!];

    // Add command and args
    if (afterSeparator.length > 0) {
      normalized.push(afterSeparator[0]!);
      if (afterSeparator.length > 1) {
        normalized.push(...afterSeparator.slice(1));
      }
    }

    // Add env vars
    for (const envVar of flags.envVars) {
      normalized.push("--env", envVar);
    }

    // Add headers (if any - unusual for stdio but allow passthrough, converted)
    for (const header of convertedHeaders) {
      normalized.push("--header", header);
    }

    return { normalizedArgs: normalized };
  }
}
