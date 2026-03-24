import type { UpstreamServerSpec } from "@mcpx/core";

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseKeyValueFlag(value: string, label: string): [string, string] {
  const split = value.indexOf("=");
  if (split <= 0 || split >= value.length - 1) {
    throw new Error(`Invalid ${label} format: ${value}. Use KEY=VALUE.`);
  }
  return [value.slice(0, split), value.slice(split + 1)];
}

export function parseCliAddCommand(command: string): { name: string; spec: UpstreamServerSpec } {
  // Remove leading "mcpx" and trim
  let trimmed = command.trim();
  if (trimmed.startsWith("mcpx ")) {
    trimmed = trimmed.slice(5).trim();
  }

  // Handle client-native commands (claude mcp add, codex mcp add, qwen mcp add, code --add-mcp)
  const parts = trimmed.split(/\s+/);

  // Check for client-native patterns
  if (parts[0] === "claude" && parts[1] === "mcp" && parts[2] === "add") {
    // Claude: claude mcp add <name> <url|command> [options]
    return parseClaudeAdd(parts.slice(3));
  }

  if (parts[0] === "codex" && parts[1] === "mcp" && parts[2] === "add") {
    // Codex: codex mcp add <name> [--env KEY=VALUE] -- <command> [args...]
    return parseCodexAdd(parts.slice(3));
  }

  if (parts[0] === "qwen" && parts[1] === "mcp" && parts[2] === "add") {
    // Qwen: qwen mcp add <name> <url|command> [options]
    return parseQwenAdd(parts.slice(3));
  }

  if (parts[0] === "code" && parts[1] === "--add-mcp") {
    // VS Code: code --add-mcp '<json>'
    return parseVSCodeAdd(parts[2]);
  }

  // Standard mcpx add command
  if (parts[0] === "add") {
    return parseStandardAdd(parts.slice(1));
  }

  // Assume it's a standard add command without "add" prefix
  return parseStandardAdd(parts);
}

export function parseStandardAdd(args: string[]): { name: string; spec: UpstreamServerSpec } {
  const header: string[] = [];
  const env: string[] = [];
  let cwd: string | undefined;
  const values: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--transport") {
      i++; // Skip next value
    } else if (arg === "--header") {
      header.push(args[++i]);
    } else if (arg === "--env") {
      env.push(args[++i]);
    } else if (arg === "--cwd") {
      cwd = args[++i];
    } else if (arg === "--force") {
      // Skip
    } else {
      values.push(arg);
    }
  }

  return buildServerSpec(values, { header, env, cwd });
}

export function parseClaudeAdd(args: string[]): { name: string; spec: UpstreamServerSpec } {
  const header: string[] = [];
  const env: string[] = [];
  let cwd: string | undefined;
  const values: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--header") {
      header.push(args[++i]);
    } else if (arg === "--env") {
      env.push(args[++i]);
    } else if (arg === "--cwd") {
      cwd = args[++i];
    } else if (arg === "--transport" || arg === "--scope") {
      i++; // Skip
    } else {
      values.push(arg);
    }
  }

  return buildServerSpec(values, { header, env, cwd });
}

export function parseCodexAdd(args: string[]): { name: string; spec: UpstreamServerSpec } {
  const header: string[] = [];
  const env: string[] = [];
  let cwd: string | undefined;
  const values: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--env") {
      env.push(args[++i]);
    } else if (arg === "--") {
      // Rest is command
      values.push(...args.slice(i + 1));
      break;
    } else {
      values.push(arg);
    }
  }

  return buildServerSpec(values, { header, env, cwd });
}

export function parseQwenAdd(args: string[]): { name: string; spec: UpstreamServerSpec } {
  const header: string[] = [];
  const env: string[] = [];
  let cwd: string | undefined;
  const values: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--header") {
      header.push(args[++i]);
    } else if (arg === "--env") {
      env.push(args[++i]);
    } else if (arg === "--cwd") {
      cwd = args[++i];
    } else if (arg === "--transport" || arg === "--scope" || arg === "--trust" || arg === "--include-tools" || arg === "--exclude-tools" || arg === "--timeout") {
      i++; // Skip
    } else {
      values.push(arg);
    }
  }

  return buildServerSpec(values, { header, env, cwd });
}

export function parseVSCodeAdd(jsonPayload: string): { name: string; spec: UpstreamServerSpec } {
  if (!jsonPayload) {
    throw new Error("Missing JSON payload for --add-mcp");
  }

  const payload = JSON.parse(jsonPayload);
  const name = payload.name;

  if (!name) {
    throw new Error("Missing 'name' in JSON payload");
  }

  if (payload.url) {
    return {
      name,
      spec: {
        transport: "http",
        url: payload.url,
        headers: payload.headers
      }
    };
  }

  if (payload.command) {
    return {
      name,
      spec: {
        transport: "stdio",
        command: payload.command,
        args: payload.args,
        env: payload.env,
        cwd: payload.cwd
      }
    };
  }

  throw new Error("JSON payload must include 'url' or 'command'");
}

export function buildServerSpec(
  values: string[],
  options: { header: string[]; env: string[]; cwd?: string }
): { name: string; spec: UpstreamServerSpec } {
  if (values.length < 2) {
    throw new Error("Usage: add [--transport auto|http|stdio] <name> <url|command> [args...]");
  }

  const name = values[0] ?? "";
  const target = values[1] ?? "";
  const trailing = values.slice(2);
  const transport = isHttpUrl(target) && trailing.length === 0 ? "http" : "stdio";

  if (transport === "http") {
    if (values.length !== 2) {
      throw new Error("HTTP upstream usage: add <name> --transport http <url>");
    }
    if (!isHttpUrl(target)) {
      throw new Error(`Invalid HTTP URL: ${target}`);
    }
    if (options.env.length > 0 || options.cwd) {
      throw new Error("--env/--cwd are only valid for stdio transport.");
    }

    const headers: Record<string, string> = {};
    for (const item of options.header) {
      const [key, value] = parseKeyValueFlag(item, "header");
      headers[key] = value;
    }

    const spec: UpstreamServerSpec = {
      transport: "http",
      url: target,
      headers: Object.keys(headers).length > 0 ? headers : undefined
    };

    return { name, spec };
  }

  if (options.header.length > 0) {
    throw new Error("--header is only valid for HTTP transport.");
  }

  const env: Record<string, string> = {};
  for (const item of options.env) {
    const [key, value] = parseKeyValueFlag(item, "env");
    env[key] = value;
  }

  const spec: UpstreamServerSpec = {
    transport: "stdio",
    command: target,
    args: trailing.length > 0 ? trailing : undefined,
    env: Object.keys(env).length > 0 ? env : undefined,
    cwd: options.cwd
  };

  return { name, spec };
}
