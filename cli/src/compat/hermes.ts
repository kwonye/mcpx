export function parseHermesArgs(args: string[]): { name: string; spec: Record<string, unknown> } | { error: string } {
  if (args.length === 0) {
    return { error: "Usage: mcpx hermes mcp add <name> --url <url> | --command <cmd>" };
  }

  let name: string | undefined;
  let url: string | undefined;
  let command: string | undefined;
  const envVars: string[] = [];
  const commandArgs: string[] = [];
  let hasAuth = false;
  let hasPreset = false;

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
    } else if (arg === "--args") {
      while (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        commandArgs.push(args[++i]);
      }
    } else if (arg === "--env") {
      const val = args[++i];
      if (val && !val.startsWith("--")) {
        envVars.push(val);
      }
    } else if (arg === "--auth") {
      hasAuth = true;
    } else if (arg === "--preset") {
      hasPreset = true;
      i++;
    }
  }

  if (!name) {
    return { error: "Server name is required." };
  }

  if (hasAuth) {
    return { error: "--auth is not supported. Use `mcpx auth` to configure auth after adding the server." };
  }

  if (hasPreset) {
    return { error: "--preset is not supported. Use `mcpx add` directly for advanced configuration." };
  }

  if (url) {
    return { name, spec: { transport: "http", url } };
  }

  if (command) {
    const spec: Record<string, unknown> = { transport: "stdio", command };
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
    return { name, spec };
  }

  return { error: "Server name is required." };
}
