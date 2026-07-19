import type { UpstreamServerSpec } from "../types.js";

export function tokenizeCommandLine(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let escaping = false;

  for (const char of command.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaping) {
    current += "\\";
  }

  if (quote) {
    throw new Error("Unterminated quoted string.");
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function parseKeyValueFlag(value: string, label: string): [string, string] {
  const split = value.indexOf("=");
  if (split <= 0 || split >= value.length - 1) {
    throw new Error(`Invalid ${label} format: ${value}. Use KEY=VALUE.`);
  }
  return [value.slice(0, split), value.slice(split + 1)];
}

export function parseCliAddCommand(command: string): { name: string; spec: UpstreamServerSpec } {
  let trimmed = command.trim();
  if (trimmed.startsWith("mcpx ")) {
    trimmed = trimmed.slice(5).trim();
  }

  const parts = tokenizeCommandLine(trimmed);

  if (parts[0] === "claude" && parts[1] === "mcp" && parts[2] === "add") {
    return parseClaudeAdd(parts.slice(3));
  }

  if (parts[0] === "codex" && parts[1] === "mcp" && parts[2] === "add") {
    return parseCodexAdd(parts.slice(3));
  }

  if (parts[0] === "qwen" && parts[1] === "mcp" && parts[2] === "add") {
    return parseQwenAdd(parts.slice(3));
  }

  if (parts[0] === "code" && parts[1] === "--add-mcp") {
    return parseVSCodeAdd(parts[2]);
  }

  if (parts[0] === "openclaw" && parts[1] === "mcp" && parts[2] === "add") {
    return parseOpenClawAdd(parts.slice(3));
  }

  if (parts[0] === "hermes" && parts[1] === "mcp" && parts[2] === "add") {
    return parseHermesAdd(parts.slice(3));
  }

  if (parts[0] === "add") {
    return parseStandardAdd(parts.slice(1));
  }

  throw new Error(
    'Unrecognized command. Supported forms: "add <name> <url|command>", "claude mcp add ...", "codex mcp add ...", "qwen mcp add ...", "code --add-mcp ...", "openclaw mcp add ...", "hermes mcp add ...".'
  );
}

function parseStandardAdd(args: string[]): { name: string; spec: UpstreamServerSpec } {
  const header: string[] = [];
  const env: string[] = [];
  let cwd: string | undefined;
  const values: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--transport") {
      i++;
    } else if (arg === "--header") {
      header.push(args[++i]);
    } else if (arg === "--env") {
      env.push(args[++i]);
    } else if (arg === "--cwd") {
      cwd = args[++i];
    } else if (arg === "--force") {
      // Skip.
    } else {
      values.push(arg);
    }
  }

  return buildServerSpec(values, { header, env, cwd });
}

function parseClaudeAdd(args: string[]): { name: string; spec: UpstreamServerSpec } {
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
      i++;
    } else {
      values.push(arg);
    }
  }

  return buildServerSpec(values, { header, env, cwd });
}

function parseCodexAdd(args: string[]): { name: string; spec: UpstreamServerSpec } {
  const env: string[] = [];
  const values: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--env") {
      env.push(args[++i]);
    } else if (arg === "--") {
      values.push(...args.slice(i + 1));
      break;
    } else {
      values.push(arg);
    }
  }

  return buildServerSpec(values, { header: [], env });
}

function parseQwenAdd(args: string[]): { name: string; spec: UpstreamServerSpec } {
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
      i++;
    } else {
      values.push(arg);
    }
  }

  return buildServerSpec(values, { header, env, cwd });
}

function parseVSCodeAdd(jsonPayload: string | undefined): { name: string; spec: UpstreamServerSpec } {
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

function parseOpenClawAdd(args: string[]): { name: string; spec: UpstreamServerSpec } {
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
    } else if (arg === "--cwd" || arg === "--workingDirectory") {
      cwd = args[++i];
    } else if (arg === "--arg") {
      values.push(args[++i]);
    } else if (arg === "--transport" || arg === "--auth" || arg === "--scope") {
      i++;
    } else {
      values.push(arg);
    }
  }

  return buildServerSpec(values, { header, env, cwd });
}

function parseHermesAdd(args: string[]): { name: string; spec: UpstreamServerSpec } {
  const env: string[] = [];
  const values: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--env") {
      env.push(args[++i]);
    } else if (arg === "--args") {
      while (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        values.push(args[++i]);
      }
    } else if (arg === "--auth") {
      i++;
    } else {
      values.push(arg);
    }
  }

  return buildServerSpec(values, { header: [], env });
}

function buildServerSpec(
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

    return {
      name,
      spec: {
        transport: "http",
        url: target,
        headers: Object.keys(headers).length > 0 ? headers : undefined
      }
    };
  }

  if (options.header.length > 0) {
    throw new Error("--header is only valid for HTTP transport.");
  }

  const env: Record<string, string> = {};
  for (const item of options.env) {
    const [key, value] = parseKeyValueFlag(item, "env");
    env[key] = value;
  }

  return {
    name,
    spec: {
      transport: "stdio",
      command: target,
      args: trailing.length > 0 ? trailing : undefined,
      env: Object.keys(env).length > 0 ? env : undefined,
      cwd: options.cwd
    }
  };
}
