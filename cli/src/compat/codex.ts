/**
 * Codex MCP compatibility layer.
 * 
 * Supports:
 * - stdio only: codex mcp add <name> [--env KEY=VALUE ...] -- <command> [args...]
 * 
 * Rejects:
 * - HTTP semantics (Codex doesn't support HTTP MCP in CLI)
 * - Config-only/project-scope semantics
 */

interface CodexParseResult {
  normalizedArgs: string[];
  error?: string;
}

interface ParsedCodexFlags {
  envVars: string[];
  hasUrlFlag: boolean;
  hasHttpSemantics: boolean;
}

/**
 * Parses Codex-style flags from argv.
 * Codex uses permissive option ordering before the `--` separator.
 */
function parseCodexFlags(argv: string[]): ParsedCodexFlags {
  const envVars: string[] = [];
  let hasUrlFlag = false;
  let hasHttpSemantics = false;

  // Find the `--` separator position (if any)
  const separatorIndex = argv.indexOf("--");
  const flagRegion = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);

  for (let i = 0; i < flagRegion.length; i++) {
    const arg = flagRegion[i];

    if (arg === "--env" || arg === "-e") {
      const value = flagRegion[i + 1];
      if (value && !value.startsWith("-")) {
        envVars.push(value);
        i++; // Skip the value
      } else {
        // Env without value - will be caught by validation
        envVars.push("");
      }
    } else if (arg === "--url") {
      hasUrlFlag = true;
      hasHttpSemantics = true;
    } else if (arg === "--http") {
      hasHttpSemantics = true;
    } else if (arg.startsWith("-") && arg !== "--") {
      // Other flags - ignore for now
    }
  }

  return {
    envVars,
    hasUrlFlag,
    hasHttpSemantics
  };
}

/**
 * Extracts positional arguments from Codex argv.
 * Handles permissive option ordering by filtering out known flags.
 */
function extractCodexPositionalArgs(argv: string[]): string[] {
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
      if (arg === "--env" || arg === "-e" || arg === "--url" || arg === "--http") {
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

      if (arg === "--env" || arg === "-e" || arg === "--url" || arg === "--http") {
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
 * Validates Codex arguments and rejects unsupported features.
 */
function validateCodexArgs(flags: ParsedCodexFlags, hasSeparator: boolean): string | null {
  if (flags.hasHttpSemantics) {
    return "Codex HTTP semantics are not supported. Use `mcpx add <name> <url>` for HTTP MCP servers.";
  }

  if (!hasSeparator) {
    return "Codex stdio mode requires `--` separator: codex mcp add <name> [--env KEY=VALUE] -- <command> [args...]";
  }

  return null;
}

/**
 * Normalizes Codex args to canonical mcpx add format.
 * 
 * Codex stdio: codex mcp add <name> [--env KEY=VALUE ...] -- <command> [args...]
 * -> mcpx add <name> <command> [args...] --env KEY=VALUE...
 */
export function parseCodexArgs(argv: string[]): CodexParseResult {
  if (argv.length === 0) {
    return {
      normalizedArgs: [],
      error: "Usage: mcpx codex mcp add <name> [--env KEY=VALUE ...] -- <command> [args...]"
    };
  }

  // Parse flags
  const flags = parseCodexFlags(argv);

  // Check for stdio separator
  const hasSeparator = argv.includes("--");

  // Validate - reject unsupported features
  const validationError = validateCodexArgs(flags, hasSeparator);
  if (validationError) {
    return {
      normalizedArgs: [],
      error: validationError
    };
  }

  // Extract positional arguments
  const positional = extractCodexPositionalArgs(argv);
  const separatorIndex = positional.indexOf("--");

  // stdio mode: <name> -- <command> [args...]
  const beforeSeparator = positional.slice(0, separatorIndex);
  const afterSeparator = positional.slice(separatorIndex + 1);

  if (beforeSeparator.length < 1) {
    return {
      normalizedArgs: [],
      error: "stdio mode requires: codex mcp add <name> -- <command> [args...]"
    };
  }

  if (afterSeparator.length === 0) {
    return {
      normalizedArgs: [],
      error: "stdio mode requires a command after `--`: codex mcp add <name> -- <command> [args...]"
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

  return { normalizedArgs: normalized };
}
