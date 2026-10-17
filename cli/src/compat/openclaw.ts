export function parseOpenClawArgs(args: string[]): { name: string; spec: Record<string, unknown> } | { error: string } {
  if (args.length === 0) {
    return { error: "Usage: mcpx openclaw mcp add <name> --url <url> | --command <cmd>" };
  }

  let name: string | undefined;
  let url: string | undefined;
  let command: string | undefined;
  let transport: string | undefined;
  const headers: string[] = [];
  const envVars: string[] = [];
  const commandArgs: string[] = [];
  let cwd: string | undefined;
  let hasAuthOAuth = false;
  let hasInclude = false;
  let hasExclude = false;
  let hasTimeout = false;
  let hasConnectTimeout = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (!name && !arg.startsWith("--")) {
      name = arg;
      continue;
    }

    if (arg === "--url") {
      url = args[++i];
    } else if (arg === "--command") {
      command = args[++i];
    } else if (arg === "--transport") {
      transport = args[++i];
    } else if (arg === "--header") {
      const val = args[++i];
      if (val && !val.startsWith("--")) {
        headers.push(val);
      }
    } else if (arg === "--arg") {
      const val = args[++i];
      if (val && !val.startsWith("--")) {
        commandArgs.push(val);
      }
    } else if (arg === "--env") {
      const val = args[++i];
      if (val && !val.startsWith("--")) {
        envVars.push(val);
      }
    } else if (arg === "--cwd") {
      cwd = args[++i];
    } else if (arg === "--auth") {
      const val = args[++i];
      if (val === "oauth") {
        hasAuthOAuth = true;
      }
    } else if (arg.startsWith("--include")) {
      hasInclude = true;
    } else if (arg.startsWith("--exclude")) {
      hasExclude = true;
    } else if (arg === "--timeout") {
      hasTimeout = true;
      i++;
    } else if (arg === "--connect-timeout") {
      hasConnectTimeout = true;
      i++;
    }
  }

  if (!name) {
    return { error: "Server name is required." };
  }

  if (hasAuthOAuth) {
    return { error: "--auth oauth is not supported. Use `mcpx auth` to configure auth after adding the server." };
  }

  if (hasInclude || hasExclude) {
    return { error: "--include/--exclude are not supported. Use `mcpx add` directly for advanced configuration." };
  }

  if (url && command) {
    return { error: "Cannot combine --url and --command. Specify one transport mode." };
  }

  if (hasTimeout) {
    return { error: "--timeout is not supported. Configure timeouts in the server config after adding." };
  }

  if (hasConnectTimeout) {
    return { error: "--connect-timeout is not supported. Configure timeouts in the server config after adding." };
  }

  if (url) {
    const spec: Record<string, unknown> = {
      transport: "http",
      url
    };
    if (headers.length > 0) {
      const headerObj: Record<string, string> = {};
      for (const h of headers) {
        const colonIndex = h.indexOf(":");
        if (colonIndex > 0) {
          const key = h.slice(0, colonIndex).trim();
          const value = h.slice(colonIndex + 1).trim();
          headerObj[key] = value;
        }
      }
      spec.headers = headerObj;
    }
    return { name, spec };
  }

  if (command) {
    const spec: Record<string, unknown> = {
      transport: "stdio",
      command
    };
    if (commandArgs.length > 0) {
      spec.args = commandArgs;
    }
    if (envVars.length > 0) {
      const envObj: Record<string, string> = {};
      for (const e of envVars) {
        const eqIndex = e.indexOf("=");
        if (eqIndex > 0) {
          envObj[e.slice(0, eqIndex)] = e.slice(eqIndex + 1);
        }
      }
      spec.env = envObj;
    }
    if (cwd) {
      spec.cwd = cwd;
    }
    return { name, spec };
  }

  return { error: "Server name is required." };
}
