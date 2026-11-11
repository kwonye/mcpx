/**
 * Server management: add/remove/enable/disable/list, plus the `mcp` compat namespace.
 */
import type { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { loadConfig, loadMergedConfig, resolveActiveConfig, loadProjectConfig } from "../core/config.js";
import { mutateActiveConfig, mutateConfig } from "../core/config-store.js";
import { addServer, removeServer, setServerEnabled, registerProject } from "../core/registry.js";
import { SecretsManager } from "../core/secrets.js";
import { fetchRegistryServerDetail, selectBestPackage, extractRequiredInputs, mapRegistryToSpec } from "../core/registry-client.js";
import { isServerEnabled, type HttpServerSpec, type StdioServerSpec, type UpstreamServerSpec } from "../types.js";
import { captureTelemetryEvent, durationBucket, markTelemetryMilestone } from "../core/telemetry.js";
import { clearOAuthCredentials } from "../core/oauth.js";
import { autoSyncManagedEntries, promptLine, type CommandContext } from "./shared.js";
import { maybeAutoConfigureAuthForAddedServer, runDeferredOAuthLogin } from "./add-auth.js";

interface AddCommandOptions {
  transport?: string;
  header: string[];
  env: string[];
  cwd?: string;
  force?: boolean;
  global?: boolean;
  local?: boolean;
}

function parseKeyValueFlag(value: string, label: string): [string, string] {
  const split = value.indexOf("=");
  if (split <= 0 || split >= value.length - 1) {
    throw new Error(`Invalid ${label} format: ${value}. Use KEY=VALUE.`);
  }

  return [value.slice(0, split), value.slice(split + 1)];
}

function parseHeader(header: string): [string, string] {
  return parseKeyValueFlag(header, "header");
}

function parseEnvVar(envVar: string): [string, string] {
  return parseKeyValueFlag(envVar, "env");
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeTransport(transport: string | undefined): "auto" | "http" | "stdio" {
  const normalized = transport?.trim().toLowerCase() || "auto";
  if (normalized !== "auto" && normalized !== "http" && normalized !== "stdio") {
    throw new Error("Invalid --transport value. Supported: auto, http, stdio.");
  }

  return normalized;
}

function parseAddServerSpec(values: string[], options: AddCommandOptions): { name: string; spec: UpstreamServerSpec } {
  if (values.length < 2) {
    throw new Error("Usage: mcpx add [--transport auto|http|stdio] <name> <url|command> [args...]");
  }

  const name = values[0] ?? "";
  if (!name.trim()) {
    throw new Error("Server name must be non-empty.");
  }
  const target = values[1] ?? "";
  if (!target.trim()) {
    throw new Error("Server target (URL or command) must be non-empty.");
  }
  const trailing = values.slice(2);
  const requestedTransport = normalizeTransport(options.transport);
  const transport = requestedTransport === "auto"
    ? (isHttpUrl(target) && trailing.length === 0 ? "http" : "stdio")
    : requestedTransport;

  if (transport === "http") {
    if (values.length !== 2) {
      throw new Error("HTTP upstream usage: mcpx add <name> --transport http <url>");
    }
    if (!isHttpUrl(target)) {
      throw new Error(`Invalid HTTP URL: ${target}`);
    }
    if ((options.env ?? []).length > 0 || options.cwd) {
      throw new Error("--env/--cwd are only valid for stdio transport.");
    }

    const headers: Record<string, string> = {};
    for (const item of options.header ?? []) {
      const [key, value] = parseHeader(item);
      headers[key] = value;
    }

    const spec: HttpServerSpec = {
      transport: "http",
      url: target,
      headers: Object.keys(headers).length > 0 ? headers : undefined
    };

    return { name, spec };
  }

  if ((options.header ?? []).length > 0) {
    throw new Error("--header is only valid for HTTP transport.");
  }

  const env: Record<string, string> = {};
  for (const item of options.env ?? []) {
    const [key, value] = parseEnvVar(item);
    env[key] = value;
  }

  if (options.cwd !== undefined && options.cwd !== null && !options.cwd.trim()) {
    throw new Error("--cwd must be non-empty when provided.");
  }
  const spec: StdioServerSpec = {
    transport: "stdio",
    command: target,
    args: trailing.length > 0 ? trailing : undefined,
    env: Object.keys(env).length > 0 ? env : undefined,
    cwd: options.cwd?.trim() || undefined
  };

  return { name, spec };
}

function registerEnabledCommand(parent: Command, enabled: boolean, cliPath: string): void {
  parent
    .command(enabled ? "enable <name>" : "disable <name>")
    .option("-g, --global", "Force target the global configuration")
    .option("-l, --local", "Force target (or initialize) a local `.mcpx.json` configuration")
    .description(`${enabled ? "Enable" : "Disable"} an upstream MCP server`)
    .action(async (name: string, options: { global?: boolean; local?: boolean }) => {
      const startedAt = Date.now();
      const { type, projectPath } = await mutateActiveConfig({ global: options.global, local: options.local }, (config) => {
        setServerEnabled(config, name, enabled);
      });

      if (type === "project" && projectPath) {
        await mutateConfig((globalConfig) => {
          registerProject(globalConfig, projectPath, globalConfig.projects?.[path.resolve(projectPath)]?.name);
        });
      }

      process.stdout.write(`${enabled ? "Enabled" : "Disabled"} server: ${name} (${type} config)\n`);
      process.stdout.write("Auto-syncing managed gateway entries across all supported clients...\n");
      await autoSyncManagedEntries(cliPath);
      captureTelemetryEvent({
        name: "operation_completed",
        properties: { operation: "server_toggle", outcome: "success", durationBucket: durationBucket(Date.now() - startedAt) }
      });
    });
}

function registerAddCommand(parent: Command, cliPath: string): void {
  parent
    .command("add [values...]")
    .allowUnknownOption(true)
    .option("--transport <transport>", "MCP transport (auto|http|stdio)", "auto")
    .option("--header <header>", "Header entry in KEY=VALUE form", (value, previous: string[] = []) => [...previous, value], [])
    .option("--env <env>", "Env entry in KEY=VALUE form for stdio upstreams", (value, previous: string[] = []) => [...previous, value], [])
    .option("--cwd <cwd>", "Working directory for stdio upstream")
    .option("--force", "Overwrite existing server with same name")
    .option("-g, --global", "Force saving to global configuration")
    .option("-l, --local", "Force saving to local project configuration")
    .description("Add an upstream MCP server")
    .action(async (values: string[], options: AddCommandOptions) => {
      const startedAt = Date.now();
      const safeValues = values ?? [];
      const secrets = new SecretsManager();

      if (safeValues.length === 1 && safeValues[0]?.includes("/")) {
        // Registry-aware add: "mcpx add @org/package"
        const registryName = safeValues[0];
        const shortName = registryName.split("/").pop() ?? registryName;

        process.stdout.write(`Fetching "${registryName}" from registry...\n`);
        const detail = await fetchRegistryServerDetail(registryName);
        const option = selectBestPackage(detail.packages, detail.remotes);
        const requiredInputs = extractRequiredInputs(option);

        const resolvedValues: Record<string, string> = {};

        if (requiredInputs.length > 0) {
          if (!process.stdin.isTTY || !process.stdout.isTTY) {
            throw new Error(`Server "${registryName}" requires inputs: ${requiredInputs.map((i) => `${i.name} (${i.kind})`).join(", ")}. Run in an interactive terminal.`);
          }

          const rl = createInterface({ input: process.stdin, output: process.stdout });
          try {
            for (const input of requiredInputs) {
              const promptText = input.description
                ? `${input.name} (${input.kind}): ${input.description}\nValue: `
                : `${input.name} (${input.kind}): `;
              const value = await promptLine(rl, promptText);
              if (!value) {
                process.stdout.write(`Skipping ${input.name} (empty value).\n`);
                continue;
              }
              resolvedValues[input.name] = value;
            }
          } finally {
            rl.close();
          }
        } else {
          process.stdout.write("No required inputs.\n");
        }

        let spec = mapRegistryToSpec(shortName, option, resolvedValues) as UpstreamServerSpec;

        // Store secret inputs in the encrypted secret store
        for (const input of requiredInputs) {
          if (!input.isSecret) continue;
          const rawValue = resolvedValues[input.name];
          if (!rawValue) continue;

          const secretName = `auth_${shortName.toLowerCase().replace(/[^a-z0-9._-]/g, "_")}_${input.kind}_${input.name.toLowerCase().replace(/[^a-z0-9._-]/g, "_")}`;
          secrets.setSecret(secretName, rawValue);

          if (input.kind === "header" && spec.transport === "http") {
            const headers = { ...(spec.headers ?? {}) };
            headers[input.name] = `secret://${secretName}`;
            spec.headers = Object.keys(headers).length > 0 ? headers : undefined;
          } else if (input.kind === "env" && spec.transport === "stdio") {
            const env = { ...(spec.env ?? {}) };
            env[input.name] = `secret://${secretName}`;
            spec.env = Object.keys(env).length > 0 ? env : undefined;
          }
        }

        const authSetup = await maybeAutoConfigureAuthForAddedServer(shortName, spec, secrets);

        const { type, projectPath, configPath } = await mutateActiveConfig({ global: options.global, local: options.local }, (config) => {
          addServer(config, shortName, spec, options.force ?? false);
        });
        if (type === "project" && projectPath) {
          await mutateConfig((globalConfig) => {
            registerProject(globalConfig, projectPath, globalConfig.projects?.[path.resolve(projectPath)]?.name);
          });
        }

        process.stdout.write(`Added server: ${shortName} (${spec.transport}) from registry "${registryName}"${type === "project" ? ` (project: ${projectPath})` : ""}\n`);
        if (authSetup.deferredOAuthLogin && spec.transport === "http") {
          await runDeferredOAuthLogin(shortName, spec, secrets, configPath);
        }
      } else {
        const parsed = parseAddServerSpec(safeValues, options);

        const authSetup = await maybeAutoConfigureAuthForAddedServer(parsed.name, parsed.spec, secrets);

        const { type, projectPath, configPath } = await mutateActiveConfig({ global: options.global, local: options.local }, (config) => {
          addServer(config, parsed.name, parsed.spec, options.force ?? false);
        });
        if (type === "project" && projectPath) {
          await mutateConfig((globalConfig) => {
            registerProject(globalConfig, projectPath, globalConfig.projects?.[path.resolve(projectPath)]?.name);
          });
        }

        process.stdout.write(`Added server: ${parsed.name} (${parsed.spec.transport})${type === "project" ? ` (project: ${projectPath})` : ""}\n`);
        if (authSetup.deferredOAuthLogin && parsed.spec.transport === "http") {
          await runDeferredOAuthLogin(parsed.name, parsed.spec, secrets, configPath);
        }
      }

      process.stdout.write("Auto-syncing managed gateway entries across all supported clients...\n");
      await autoSyncManagedEntries(cliPath);
      markTelemetryMilestone("first_server_added");
      captureTelemetryEvent({
        name: "operation_completed",
        properties: { operation: "server_add", outcome: "success", durationBucket: durationBucket(Date.now() - startedAt) }
      });
    });
}

function registerRemoveCommand(parent: Command, cliPath: string): void {
  parent
    .command("remove <name>")
    .option("--force", "Do not error if server does not exist")
    .option("-g, --global", "Force target global configuration")
    .option("-l, --local", "Force target local project configuration")
    .description("Remove an upstream MCP server")
    .action(async (name: string, options: { force?: boolean; global?: boolean; local?: boolean }) => {
      const startedAt = Date.now();
      const { type, projectPath } = await mutateActiveConfig({ global: options.global, local: options.local }, (config) => {
        removeServer(config, name, options.force ?? false);
      });

      // Only clear OAuth credentials on a true global removal -- a project-local
      // removal (-l) leaves the server's global definition (and any shared
      // credentials) untouched, since other projects or the global config may
      // still reference the same server name.
      if (type === "global") {
        clearOAuthCredentials(name, new SecretsManager());
      }

      process.stdout.write(`Removed server: ${name} ${type === "project" ? `from project: ${projectPath}` : "globally"}\n`);
      process.stdout.write("Auto-syncing managed gateway entries across all supported clients...\n");
      await autoSyncManagedEntries(cliPath);
      captureTelemetryEvent({
        name: "operation_completed",
        properties: { operation: "server_remove", outcome: "success", durationBucket: durationBucket(Date.now() - startedAt) }
      });
    });
}

function registerListCommand(parent: Command): void {
  parent
    .command("list")
    .option("--json", "Output JSON")
    .option("-g, --global", "Force target global configuration")
    .option("-l, --local", "Force target local project configuration")
    .description("List configured upstream MCP servers")
    .action((options: { json?: boolean; global?: boolean; local?: boolean }) => {
      let servers: Array<UpstreamServerSpec & { name: string; projectName?: string }> = [];

      if (options.global || options.local) {
        const context = resolveActiveConfig({ global: options.global, local: options.local });
        servers = Object.entries(context.config.servers).map(([name, spec]) => ({
          name,
          ...spec,
          projectName: context.type === "project" ? (context.config.name || path.basename(context.projectPath!)) : undefined
        }));
      } else {
        const mergedConfig = loadMergedConfig();
        const globalConfig = loadConfig();
        const projectNamesMap = new Map<string, string>();
        if (globalConfig.projects) {
          for (const [projectPath, entry] of Object.entries(globalConfig.projects)) {
            const localPath = path.join(projectPath, ".mcpx.json");
            if (fs.existsSync(localPath)) {
              try {
                const localConfig = loadProjectConfig(localPath);
                const pName = localConfig.name || entry.name || path.basename(projectPath);
                projectNamesMap.set(pName, projectPath);
              } catch {
                // Ignore
              }
            }
          }
        }

        servers = Object.entries(mergedConfig.servers).map(([name, spec]) => {
          let projectName: string | undefined;
          let baseName = name;
          
          for (const pName of projectNamesMap.keys()) {
            if (name.startsWith(`${pName}.`)) {
              projectName = pName;
              baseName = name.slice(pName.length + 1);
              break;
            }
          }

          return {
            name: baseName,
            ...spec,
            projectName
          };
        });
      }

      if (options.json) {
        process.stdout.write(`${JSON.stringify({ servers }, null, 2)}\n`);
        return;
      }

      if (servers.length === 0) {
        process.stdout.write("No upstream servers configured.\n");
        return;
      }

      for (const server of servers) {
        const state = isServerEnabled(server) ? "enabled" : "disabled";
        const scope = server.projectName ? `project: ${server.projectName}` : "global";
        if (server.transport === "http") {
          process.stdout.write(`- ${server.name} (${state}, http, ${scope}) ${server.url}\n`);
        } else {
          const args = (server.args ?? []).join(" ");
          process.stdout.write(`- ${server.name} (${state}, stdio, ${scope}) ${server.command}${args ? ` ${args}` : ""}\n`);
        }
      }
    });
}

export function registerMcpCompat(program: Command, { cliPath }: CommandContext): void {
  const mcp = program.command("mcp").description("Compatibility namespace for MCP commands");
  registerAddCommand(mcp, cliPath);
  registerRemoveCommand(mcp, cliPath);
  registerEnabledCommand(mcp, true, cliPath);
  registerEnabledCommand(mcp, false, cliPath);
  registerListCommand(mcp);
}

export function registerServers(program: Command, { cliPath }: CommandContext): void {
  registerAddCommand(program, cliPath);
  registerRemoveCommand(program, cliPath);
  registerEnabledCommand(program, true, cliPath);
  registerEnabledCommand(program, false, cliPath);
  registerListCommand(program);
}
