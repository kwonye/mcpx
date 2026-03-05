/**
 * Qwen CLI MCP compatibility layer.
 *
 * Supports:
 * - stdio add: qwen mcp add <name> <command> [args...] [--env KEY=VALUE]...
 * - HTTP add: qwen mcp add --transport http <name> <url> [--header "Name: Value"]...
 * - SSE add: qwen mcp add --transport sse <name> <url>
 *
 * Rejects:
 * - --scope (user/project scope not supported in mcpx)
 * - --trust (trust bypass not supported)
 * - --include-tools / --exclude-tools (tool filtering not supported)
 * - --timeout (timeout config not supported in mcpx add)
 */

interface QwenParseResult {
  normalizedArgs: string[];
  error?: string;
}

interface ParsedQwenFlags {
  headers: string[];
  envVars: string[];
  transport?: "stdio" | "http" | "sse";
  timeout?: string;
  trust: boolean;
  includeTools: string[];
  excludeTools: string[];
  description?: string;
  hasScope: boolean;
}

/**
 * Parses Qwen-style flags from argv, handling permissive option ordering.
 */
function parseQwenFlags(argv: string[]): ParsedQwenFlags {
  const headers: string[] = [];
  const envVars: string[] = [];
  let transport: "stdio" | "http" | "sse" | undefined;
  let timeout: string | undefined;
  let trust = false;
  const includeTools: string[] = [];
  const excludeTools: string[] = [];
  let description: string | undefined;
  let hasScope = false;

  // Find the `--` separator position (if any)
  const separatorIndex = argv.indexOf("--");
  const flagRegion = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);

  for (let i = 0; i < flagRegion.length; i++) {
    const arg = flagRegion[i];

    if (arg === "--header" || arg === "-H") {
      const value = flagRegion[i + 1];
      if (value && !value.startsWith("-")) {
        headers.push(value);
        i++;
      }
    } else if (arg === "--env" || arg === "-e") {
      const value = flagRegion[i + 1];
      if (value && !value.startsWith("-")) {
        envVars.push(value);
        i++;
      }
    } else if (arg === "--transport" || arg === "-t") {
      const value = flagRegion[i + 1];
      if (value && (value === "stdio" || value === "http" || value === "sse")) {
        transport = value as "stdio" | "http" | "sse";
      }
      i++;
    } else if (arg === "--scope" || arg === "-s") {
      hasScope = true;
      i++; // Skip scope value
    } else if (arg === "--timeout") {
      timeout = flagRegion[i + 1];
      i++;
    } else if (arg === "--trust") {
      trust = true;
    } else if (arg === "--include-tools") {
      const value = flagRegion[i + 1];
      if (value) {
        includeTools.push(...value.split(",").map((t) => t.trim()));
        i++;
      }
    } else if (arg === "--exclude-tools") {
      const value = flagRegion[i + 1];
      if (value) {
        excludeTools.push(...value.split(",").map((t) => t.trim()));
        i++;
      }
    } else if (arg === "--description") {
      description = flagRegion[i + 1];
      i++;
    }
  }

  return {
    headers,
    envVars,
    transport,
    timeout,
    trust,
    includeTools,
    excludeTools,
    description,
    hasScope
  };
}

/**
 * Extracts positional arguments (name, command/url, args) from Qwen argv.
 * 
 * Qwen format: <name> [flags] <command> [command args...]
 * Flags like --env, --header, --transport come before the command.
 * Everything after the first non-flag positional (after name) is treated as command+args.
 */
function extractPositionalArgs(argv: string[]): string[] {
  const separatorIndex = argv.indexOf("--");

  if (separatorIndex === -1) {
    const positional: string[] = [];
    let skipNext = false;
    let foundCommand = false;

    for (let i = 0; i < argv.length; i++) {
      if (skipNext) {
        skipNext = false;
        continue;
      }

      const arg = argv[i];

      // Skip known flags and their values
      if (
        arg === "--header" ||
        arg === "-H" ||
        arg === "--env" ||
        arg === "-e" ||
        arg === "--transport" ||
        arg === "-t" ||
        arg === "--scope" ||
        arg === "-s" ||
        arg === "--timeout" ||
        arg === "--trust" ||
        arg === "--include-tools" ||
        arg === "--exclude-tools" ||
        arg === "--description"
      ) {
        skipNext = true;
        continue;
      }

      // Before finding the command, skip other long flags
      if (!foundCommand && arg.startsWith("--") && !arg.includes("=")) {
        continue;
      }

      // First non-flag positional after name is the command
      // After that, include everything (including short flags like -m, -y)
      if (!foundCommand && positional.length === 1) {
        // This is the command
        foundCommand = true;
      }

      positional.push(arg);
    }

    return positional;
  } else {
    const beforeSeparator = argv.slice(0, separatorIndex);
    const afterSeparator = argv.slice(separatorIndex + 1);

    const positional: string[] = [];
    let skipNext = false;
    let foundCommand = false;

    for (let i = 0; i < beforeSeparator.length; i++) {
      if (skipNext) {
        skipNext = false;
        continue;
      }

      const arg = beforeSeparator[i];

      if (
        arg === "--header" ||
        arg === "-H" ||
        arg === "--env" ||
        arg === "-e" ||
        arg === "--transport" ||
        arg === "-t" ||
        arg === "--scope" ||
        arg === "-s" ||
        arg === "--timeout" ||
        arg === "--trust" ||
        arg === "--include-tools" ||
        arg === "--exclude-tools" ||
        arg === "--description"
      ) {
        skipNext = true;
        continue;
      }

      // Skip other long flags before command
      if (!foundCommand && arg.startsWith("--") && !arg.includes("=")) {
        continue;
      }

      // First non-flag positional after name is the command
      if (!foundCommand && positional.length === 1) {
        foundCommand = true;
      }

      positional.push(arg);
    }

    return [...positional, "--", ...afterSeparator];
  }
}

/**
 * Validates Qwen arguments and rejects unsupported features.
 */
function validateQwenArgs(flags: ParsedQwenFlags): string | null {
  if (flags.hasScope) {
    return "Qwen --scope is not supported. Use global `mcpx add` for project-wide servers.";
  }

  if (flags.trust) {
    return "Qwen --trust is not supported. Use `mcpx auth` to configure auth after adding the server.";
  }

  if (flags.includeTools.length > 0 || flags.excludeTools.length > 0) {
    return "Qwen --include-tools/--exclude-tools are not supported. Use `mcpx add` directly for advanced configuration.";
  }

  if (flags.timeout) {
    return "Qwen --timeout is not supported. Configure timeouts in the server config after adding.";
  }

  if (flags.transport === "sse") {
    return "Qwen --transport sse is not supported. Use `mcpx add <name> <url>` for HTTP/SSE servers.";
  }

  return null;
}

/**
 * Normalizes Qwen args to canonical mcpx add format.
 *
 * Qwen stdio: qwen mcp add <name> <command> [args...] [--env KEY=VALUE]...
 * -> mcpx add <name> <command> [args...] --env KEY=VALUE...
 *
 * Qwen HTTP: qwen mcp add --transport http <name> <url> [--header "Name: Value"]...
 * -> mcpx add <name> <url> --transport http --header "Name=Value"...
 */
export function parseQwenArgs(argv: string[]): QwenParseResult {
  if (argv.length === 0) {
    return {
      normalizedArgs: [],
      error: "Usage: mcpx qwen mcp add <name> <commandOrUrl> [options...]"
    };
  }

  // Parse flags
  const flags = parseQwenFlags(argv);

  // Validate - reject unsupported features
  const validationError = validateQwenArgs(flags);
  if (validationError) {
    return {
      normalizedArgs: [],
      error: validationError
    };
  }

  // Convert Qwen-style headers (Name: Value) to mcpx format (Name=Value)
  const convertedHeaders = flags.headers.map((header) => {
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

  // Determine transport mode
  // HTTP mode requires explicit --transport http OR second positional is a URL
  const secondPositional = positional[1];
  const isHttpUrl = secondPositional && (secondPositional.startsWith("http://") || secondPositional.startsWith("https://"));
  const isHttpMode = flags.transport === "http" || (flags.transport === undefined && isHttpUrl);

  if (isHttpMode && separatorIndex === -1) {
    // HTTP mode: <name> <url>
    if (positional.length < 2) {
      return {
        normalizedArgs: [],
        error: "HTTP mode requires: qwen mcp add <name> <url>"
      };
    }

    const [name, url, ...rest] = positional;

    const normalized: string[] = [name!, url!];

    // Add headers (converted from Name: Value to Name=Value)
    for (const header of convertedHeaders) {
      normalized.push("--header", header);
    }

    // Add transport flag if explicitly HTTP (at the end for consistency)
    if (flags.transport === "http") {
      normalized.push("--transport", "http");
    }

    // Add any remaining positionals as args
    if (rest.length > 0) {
      normalized.push(...rest);
    }

    return { normalizedArgs: normalized };
  } else {
    // stdio mode: <name> <command> [args...]
    const beforeSeparator = separatorIndex === -1 ? positional : positional.slice(0, separatorIndex);
    const afterSeparator = separatorIndex === -1 ? [] : positional.slice(separatorIndex + 1);

    if (beforeSeparator.length < 1) {
      return {
        normalizedArgs: [],
        error: "stdio mode requires: qwen mcp add <name> <command> [args...]"
      };
    }

    const name = beforeSeparator[0];
    const command = beforeSeparator[1];

    if (!command) {
      return {
        normalizedArgs: [],
        error: "stdio mode requires a command: qwen mcp add <name> <command> [args...]"
      };
    }

    const normalized: string[] = [name!, command!];

    // Add command args (before separator, after name and command)
    const commandArgs = beforeSeparator.slice(2);
    if (commandArgs.length > 0) {
      normalized.push(...commandArgs);
    }

    // Add args after separator
    if (afterSeparator.length > 0) {
      normalized.push("--", ...afterSeparator);
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
