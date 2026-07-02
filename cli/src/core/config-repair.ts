import type { McpxConfig, UpstreamServerSpec } from "../types.js";
import { tokenizeCommandLine } from "./add-command.js";

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isClientInternalCommand(command: string): boolean {
  return /\.app\/Contents\//.test(command);
}

function repairServerSpec(spec: UpstreamServerSpec): UpstreamServerSpec | null {
  if (spec.transport !== "stdio") {
    return spec;
  }

  if (isClientInternalCommand(spec.command)) {
    return null;
  }

  let commandParts: string[];
  try {
    commandParts = tokenizeCommandLine(spec.command);
  } catch {
    return spec;
  }
  if (commandParts.length === 1) {
    const command = commandParts[0] ?? spec.command;
    if (isHttpUrl(command) && (!spec.args || spec.args.length === 0)) {
      return {
        transport: "http",
        url: command,
        enabled: spec.enabled
      };
    }
    return {
      ...spec,
      command
    };
  }

  const [command, ...commandArgs] = commandParts;
  return {
    ...spec,
    command,
    args: [...commandArgs, ...(spec.args ?? [])]
  };
}

export function repairConfig(config: McpxConfig): McpxConfig {
  const servers: McpxConfig["servers"] = {};

  for (const [name, spec] of Object.entries(config.servers)) {
    const repaired = repairServerSpec(spec);
    if (repaired) {
      servers[name] = repaired;
    }
  }

  // Prune disabledServers entries referencing nonexistent servers
  const existingNames = new Set(Object.keys(servers));
  if (config.projects) {
    for (const project of Object.values(config.projects)) {
      if (project.disabledServers) {
        project.disabledServers = project.disabledServers.filter((s) => existingNames.has(s));
      }
    }
  }

  return {
    ...config,
    servers
  };
}
