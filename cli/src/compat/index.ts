/**
 * Client-native compatibility layer for mcpx CLI.
 * 
 * This module detects client-native argv patterns before Commander parses
 * and normalizes them to canonical `mcpx add` format.
 */

import { parseClaudeArgs } from "./claude.js";
import { parseCodexArgs } from "./codex.js";
import { parseVSCodeArgs } from "./vscode.js";
import { parseQwenArgs } from "./qwen.js";
import { detectUnsupportedClient } from "./unsupported.js";

export interface CompatibilityResult {
  /** The detected client name, or null if using canonical mcpx add */
  client: string | null;
  /** Normalized args for canonical `mcpx add`, or null if not a compatibility command */
  normalizedArgs: string[] | null;
  /** Error message if the command is unsupported or invalid */
  error?: string;
}

/**
 * Detects client-native argv patterns and normalizes them to canonical mcpx add format.
 * 
 * @param argv - The command-line arguments (typically process.argv.slice(2))
 * @returns Compatibility result with normalized args or error
 */
export function parseCompatibilityArgs(argv: string[]): CompatibilityResult {
  // Check for unsupported client patterns first (before valid patterns)
  const unsupported = detectUnsupportedClient(argv);
  if (unsupported) {
    return {
      client: unsupported.client,
      normalizedArgs: null,
      error: unsupported.error
    };
  }

  // Check for Claude: mcpx claude mcp add ...
  if (argv[0] === "claude" && argv[1] === "mcp" && argv[2] === "add") {
    const claudeArgs = argv.slice(3);
    const result = parseClaudeArgs(claudeArgs);
    if (result.error) {
      return {
        client: "claude",
        normalizedArgs: null,
        error: result.error
      };
    }
    return {
      client: "claude",
      normalizedArgs: result.normalizedArgs
    };
  }

  // Check for Codex: mcpx codex mcp add ...
  if (argv[0] === "codex" && argv[1] === "mcp" && argv[2] === "add") {
    const codexArgs = argv.slice(3);
    const result = parseCodexArgs(codexArgs);
    if (result.error) {
      return {
        client: "codex",
        normalizedArgs: null,
        error: result.error
      };
    }
    return {
      client: "codex",
      normalizedArgs: result.normalizedArgs
    };
  }

  // Check for VS Code: mcpx code --add-mcp '<json>'
  if (argv[0] === "code" && argv[1] === "--add-mcp") {
    const jsonPayload = argv[2];
    const result = parseVSCodeArgs(jsonPayload);
    if (result.error) {
      return {
        client: "vscode",
        normalizedArgs: null,
        error: result.error
      };
    }
    return {
      client: "vscode",
      normalizedArgs: result.normalizedArgs
    };
  }

  // Check for Qwen: mcpx qwen mcp add ...
  if (argv[0] === "qwen" && argv[1] === "mcp" && argv[2] === "add") {
    const qwenArgs = argv.slice(3);
    const result = parseQwenArgs(qwenArgs);
    if (result.error) {
      return {
        client: "qwen",
        normalizedArgs: null,
        error: result.error
      };
    }
    return {
      client: "qwen",
      normalizedArgs: result.normalizedArgs
    };
  }

  // Not a client-native compatibility command
  return {
    client: null,
    normalizedArgs: null
  };
}

/**
 * Checks if argv matches any client-native pattern.
 * 
 * @param argv - The command-line arguments
 * @returns True if argv matches a client-native pattern
 */
export function isClientNativeCommand(argv: string[]): boolean {
  const result = parseCompatibilityArgs(argv);
  return result.client !== null;
}
