#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { loadConfig, saveConfig } from "./core/config.js";
import { addServer, removeServer } from "./core/registry.js";
import { SecretsManager, readSecretValueFromStdin } from "./core/secrets.js";
import { syncAllClients } from "./core/sync.js";
import type { ClientId, HttpServerSpec, McpxConfig, StdioServerSpec, UpstreamServerSpec } from "./types.js";
import {
  applyAuthReference,
  defaultAuthSecretName,
  listAuthBindings,
  maybePrefixBearer,
  removeAuthReference,
  resolveAuthTarget,
  secretRefName,
  toSecretRef
} from "./core/server-auth.js";
import { getAdapters } from "./adapters/index.js";
import {
  getDaemonStatus,
  readDaemonLogs,
  restartDaemon,
  runDaemonForeground,
  startDaemon,
  stopDaemon
} from "./core/daemon.js";
import { getConfigPath, getManagedIndexPath } from "./core/paths.js";
import { loadManagedIndex } from "./core/managed-index.js";

const VALID_CLIENTS: ClientId[] = ["claude", "codex", "cursor", "cline", "opencode", "kiro", "vscode"];

interface AddCommandOptions {
  transport?: string;
  header: string[];
  env: string[];
  cwd?: string;
  force?: boolean;
}

interface AuthSetOptions {
  header?: string;
  env?: string;
  value?: string;
  secretName?: string;
  raw?: boolean;
}

interface AuthRemoveOptions {
  header?: string;
  env?: string;
  deleteSecret?: boolean;
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
  const target = values[1] ?? "";
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

  const spec: StdioServerSpec = {
    transport: "stdio",
    command: target,
    args: trailing.length > 0 ? trailing : undefined,
    env: Object.keys(env).length > 0 ? env : undefined,
    cwd: options.cwd?.trim() || undefined
  };

  return { name, spec };
}

function getServerSpecOrThrow(config: McpxConfig, serverName: string): UpstreamServerSpec {
  const spec = config.servers[serverName];
  if (!spec) {
    throw new Error(`Server "${serverName}" does not exist.`);
  }

  return spec;
}

function redactAuthValue(value: string): string {
  if (value.startsWith("secret://")) {
    return value;
  }

  return "<inline>";
}

function parseClientList(values: string[] | undefined): ClientId[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }

  const normalized = values.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  const unique = Array.from(new Set(normalized));

  for (const client of unique) {
    if (!VALID_CLIENTS.includes(client as ClientId)) {
      throw new Error(`Unknown client: ${client}. Valid clients: ${VALID_CLIENTS.join(", ")}`);
    }
  }

  return unique as ClientId[];
}

function ensureExitCodeForSyncFailures(hasErrors: boolean): void {
  if (hasErrors) {
    process.exitCode = 2;
  }
}

function printSyncSummary(summary: ReturnType<typeof syncAllClients>, asJson = false): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  process.stdout.write(`Gateway: ${summary.gatewayUrl}\n`);
  for (const result of summary.results) {
    process.stdout.write(`- ${result.clientId}: ${result.status}`);
    if (result.configPath) {
      process.stdout.write(` (${result.configPath})`);
    }
    if (result.message) {
      process.stdout.write(` - ${result.message}`);
    }
    process.stdout.write("\n");
  }
}

async function ensureDaemonIfEnabled(cliPath: string, secrets: SecretsManager): Promise<void> {
  if (process.env.MCPX_SKIP_DAEMON_AUTOSTART === "1") {
    return;
  }

  const config = loadConfig();
  if (!config.gateway.autoStart) {
    return;
  }

  await startDaemon(config, cliPath, secrets);
}

async function autoSyncManagedEntries(config: McpxConfig): Promise<void> {
  const secrets = new SecretsManager();
  await ensureDaemonIfEnabled(process.argv[1] ?? "", secrets);
  const summary = syncAllClients(config, secrets);
  printSyncSummary(summary, false);
  ensureExitCodeForSyncFailures(summary.hasErrors);
}

function registerAddCommand(parent: Command): void {
  parent
    .command("add [values...]")
    .allowUnknownOption(true)
    .option("--transport <transport>", "MCP transport (auto|http|stdio)", "auto")
    .option("--header <header>", "Header entry in KEY=VALUE form", (value, previous: string[] = []) => [...previous, value], [])
    .option("--env <env>", "Env entry in KEY=VALUE form for stdio upstreams", (value, previous: string[] = []) => [...previous, value], [])
    .option("--cwd <cwd>", "Working directory for stdio upstream")
    .option("--force", "Overwrite existing server with same name")
    .description("Add an upstream MCP server")
    .action(async (values: string[], options: AddCommandOptions) => {
      const config = loadConfig();
      const parsed = parseAddServerSpec(values ?? [], options);

      addServer(config, parsed.name, parsed.spec, options.force ?? false);
      saveConfig(config);

      process.stdout.write(`Added server: ${parsed.name} (${parsed.spec.transport})\n`);
      process.stdout.write("Auto-syncing managed gateway entries across all supported clients...\n");
      await autoSyncManagedEntries(config);
    });
}

function registerRemoveCommand(parent: Command): void {
  parent
    .command("remove <name>")
    .option("--force", "Do not error if server does not exist")
    .description("Remove an upstream MCP server")
    .action(async (name: string, options: { force?: boolean }) => {
      const config = loadConfig();
      removeServer(config, name, options.force ?? false);
      saveConfig(config);

      process.stdout.write(`Removed server: ${name}\n`);
      process.stdout.write("Auto-syncing managed gateway entries across all supported clients...\n");
      await autoSyncManagedEntries(config);
    });
}

function registerListCommand(parent: Command): void {
  parent
    .command("list")
    .option("--json", "Output JSON")
    .description("List configured upstream MCP servers")
    .action((options: { json?: boolean }) => {
      const config = loadConfig();
      const servers = Object.entries(config.servers).map(([name, spec]) => ({ name, ...spec }));

      if (options.json) {
        process.stdout.write(`${JSON.stringify({ servers }, null, 2)}\n`);
        return;
      }

      if (servers.length === 0) {
        process.stdout.write("No upstream servers configured.\n");
        return;
      }

      for (const server of servers) {
        if (server.transport === "http") {
          process.stdout.write(`- ${server.name} (http) ${server.url}\n`);
        } else {
          const args = (server.args ?? []).join(" ");
          process.stdout.write(`- ${server.name} (stdio) ${server.command}${args ? ` ${args}` : ""}\n`);
        }
      }
    });
}

function registerSyncCommand(program: Command): void {
  program
    .command("sync [clients...]")
    .option("--client <id>", "Limit sync to specific client(s), comma-separated or repeated", (value, prev: string[] = []) => [...prev, value], [])
    .option("--json", "Output JSON")
    .description("Sync gateway configuration to supported clients (e.g. `mcpx sync claude`)")
    .action(async (clients: string[], options: { client: string[]; json?: boolean }) => {
      const config = loadConfig();
      const targetClients = parseClientList([...(clients ?? []), ...(options.client ?? [])]);
      const secrets = new SecretsManager();
      await ensureDaemonIfEnabled(process.argv[1] ?? "", secrets);
      const summary = syncAllClients(config, secrets, targetClients);
      printSyncSummary(summary, options.json ?? false);
      ensureExitCodeForSyncFailures(summary.hasErrors);
    });
}

function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .option("--json", "Output JSON")
    .description("Show gateway, daemon, and client sync status")
    .action((options: { json?: boolean }) => {
      const config = loadConfig();
      const daemon = getDaemonStatus(config);
      const statusPayload = {
        gatewayUrl: `http://127.0.0.1:${config.gateway.port}/mcp`,
        daemon,
        clients: config.clients,
        upstreamCount: Object.keys(config.servers).length
      };

      if (options.json) {
        process.stdout.write(`${JSON.stringify(statusPayload, null, 2)}\n`);
        return;
      }

      process.stdout.write(`Gateway URL: ${statusPayload.gatewayUrl}\n`);
      process.stdout.write(`Daemon: ${daemon.running ? `running (pid ${daemon.pid})` : "stopped"}\n`);
      process.stdout.write(`Upstream servers: ${statusPayload.upstreamCount}\n`);
      for (const client of VALID_CLIENTS) {
        const state = config.clients[client];
        if (!state) {
          process.stdout.write(`- ${client}: SKIPPED\n`);
        } else {
          process.stdout.write(`- ${client}: ${state.status}${state.message ? ` - ${state.message}` : ""}\n`);
        }
      }
    });
}

function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .option("--json", "Output JSON")
    .description("Run local health checks")
    .action((options: { json?: boolean }) => {
      const config = loadConfig();
      const adapters = getAdapters();
      const checks: Array<{ check: string; status: "ok" | "warn" | "fail"; details: string }> = [];

      checks.push({
        check: "config_path",
        status: fs.existsSync(getConfigPath()) ? "ok" : "warn",
        details: getConfigPath()
      });

      checks.push({
        check: "managed_index_path",
        status: fs.existsSync(getManagedIndexPath()) ? "ok" : "warn",
        details: getManagedIndexPath()
      });

      if (process.platform === "darwin") {
        try {
          execFileSync("security", ["help"], { stdio: "ignore" });
          checks.push({ check: "macos_keychain", status: "ok", details: "security CLI available" });
        } catch {
          checks.push({ check: "macos_keychain", status: "fail", details: "security CLI unavailable" });
        }
      } else {
        checks.push({ check: "macos_keychain", status: "warn", details: "Non-macOS platform; keychain integration unavailable" });
      }

      const daemon = getDaemonStatus(config);
      checks.push({
        check: "daemon",
        status: daemon.running ? "ok" : "warn",
        details: daemon.running ? `pid ${daemon.pid}` : "not running"
      });

      for (const adapter of adapters) {
        const configPath = adapter.detectConfigPath();
        if (!configPath) {
          checks.push({
            check: `client_${adapter.id}`,
            status: "warn",
            details: "no known config path"
          });
          continue;
        }

        checks.push({
          check: `client_${adapter.id}`,
          status: adapter.supportsHttp() ? "ok" : "warn",
          details: `${configPath}${adapter.supportsHttp() ? "" : " (HTTP unsupported)"}`
        });
      }

      if (options.json) {
        process.stdout.write(`${JSON.stringify({ checks }, null, 2)}\n`);
        return;
      }

      for (const item of checks) {
        process.stdout.write(`[${item.status.toUpperCase()}] ${item.check}: ${item.details}\n`);
      }

      if (checks.some((item) => item.status === "fail")) {
        process.exitCode = 1;
      }
    });
}

function registerDaemonCommands(program: Command): void {
  const daemon = program.command("daemon").description("Manage mcpx local gateway daemon");

  daemon
    .command("start")
    .description("Start background daemon")
    .action(async () => {
      const config = loadConfig();
      const result = await startDaemon(config, process.argv[1] ?? "", new SecretsManager());
      process.stdout.write(`${result.message} pid=${result.pid} port=${result.port}\n`);
    });

  daemon
    .command("stop")
    .description("Stop background daemon")
    .action(() => {
      const result = stopDaemon();
      process.stdout.write(`${result.message}\n`);
    });

  daemon
    .command("restart")
    .description("Restart background daemon")
    .action(async () => {
      const config = loadConfig();
      const result = await restartDaemon(config, process.argv[1] ?? "", new SecretsManager());
      process.stdout.write(`mcpx daemon restarted. pid=${result.pid} port=${result.port}\n`);
    });

  daemon
    .command("status")
    .description("Show daemon status")
    .action(() => {
      const status = getDaemonStatus(loadConfig());
      if (status.running) {
        process.stdout.write(`running pid=${status.pid} port=${status.port}\n`);
      } else {
        process.stdout.write("stopped\n");
      }
    });

  daemon
    .command("logs")
    .option("--lines <n>", "Number of lines", "200")
    .description("Show recent daemon logs")
    .action((options: { lines: string }) => {
      const lines = Number(options.lines);
      process.stdout.write(`${readDaemonLogs(Number.isFinite(lines) ? lines : 200)}\n`);
    });

  daemon
    .command("run")
    .option("--port <port>", "Port override")
    .description("Run gateway in foreground (used by daemon manager)")
    .action(async (options: { port?: string }) => {
      const config = loadConfig();
      const port = options.port ? Number(options.port) : config.gateway.port;
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid port: ${options.port}`);
      }

      process.stdout.write(`Starting mcpx gateway on http://127.0.0.1:${port}/mcp\n`);
      await runDaemonForeground(config, port, new SecretsManager());
    });
}

function registerSecretsCommands(program: Command): void {
  const secret = program.command("secret").description("Manage keychain-backed secrets");

  secret
    .command("set <name>")
    .option("--value <value>", "Secret value")
    .description("Set secret in OS keychain")
    .action((name: string, options: { value?: string }) => {
      const value = options.value ?? readSecretValueFromStdin();
      new SecretsManager().setSecret(name, value);
      process.stdout.write(`Secret set: ${name}\n`);
    });

  secret
    .command("rm <name>")
    .description("Remove secret from OS keychain")
    .action((name: string) => {
      new SecretsManager().removeSecret(name);
      process.stdout.write(`Secret removed: ${name}\n`);
    });

  secret
    .command("ls")
    .description("List secret names tracked by mcpx")
    .action(() => {
      const names = new SecretsManager().listSecretNames();
      if (names.length === 0) {
        process.stdout.write("No tracked secrets.\n");
        return;
      }

      for (const name of names) {
        process.stdout.write(`${name}\n`);
      }
    });
}

function registerAuthCommands(program: Command): void {
  const auth = program.command("auth").description("Auth utilities");

  auth
    .command("set <server>")
    .option("--header <name>", "HTTP header name (default for HTTP servers: Authorization)")
    .option("--env <name>", "Env var name (required for stdio servers)")
    .option("--value <value>", "Auth value/token (if omitted, read from stdin)")
    .option("--secret-name <name>", "Override keychain secret name")
    .option("--raw", "Do not auto-prefix Authorization values with Bearer")
    .description("Store auth in keychain and bind it to an upstream server")
    .action((server: string, options: AuthSetOptions) => {
      const config = loadConfig();
      const spec = getServerSpecOrThrow(config, server);
      const target = resolveAuthTarget(spec, options.header, options.env);
      const provided = options.value ?? readSecretValueFromStdin();
      const authValue = maybePrefixBearer(target, provided, options.raw ?? false);
      const secretName = options.secretName?.trim() || defaultAuthSecretName(server, target);

      const secrets = new SecretsManager();
      secrets.setSecret(secretName, authValue);
      applyAuthReference(spec, target, toSecretRef(secretName));
      saveConfig(config);

      process.stdout.write(`Configured auth for server "${server}" via ${target.kind} "${target.key}".\n`);
      process.stdout.write(`Stored secret: ${secretName}\n`);
    });

  auth
    .command("rm <server>")
    .option("--header <name>", "HTTP header name (default for HTTP servers: Authorization)")
    .option("--env <name>", "Env var name (required for stdio servers)")
    .option("--delete-secret", "Delete referenced keychain secret when removing binding")
    .description("Remove auth binding from an upstream server")
    .action((server: string, options: AuthRemoveOptions) => {
      const config = loadConfig();
      const spec = getServerSpecOrThrow(config, server);
      const target = resolveAuthTarget(spec, options.header, options.env);
      const removedValue = removeAuthReference(spec, target);

      if (!removedValue) {
        process.stdout.write(`No auth binding found for server "${server}" at ${target.kind} "${target.key}".\n`);
        return;
      }

      if (options.deleteSecret) {
        const secretName = secretRefName(removedValue);
        if (secretName) {
          new SecretsManager().removeSecret(secretName);
          process.stdout.write(`Removed binding and deleted secret: ${secretName}\n`);
        } else {
          process.stdout.write("Removed binding. Value was inline (no keychain secret deleted).\n");
        }
      } else {
        process.stdout.write("Removed binding.\n");
      }

      saveConfig(config);
    });

  auth
    .command("show [server]")
    .option("--json", "Output JSON")
    .description("Show configured upstream auth bindings (secret refs only, values redacted)")
    .action((server: string | undefined, options: { json?: boolean }) => {
      const config = loadConfig();
      const names = server ? [server] : Object.keys(config.servers);
      const output = names.map((name) => {
        const spec = getServerSpecOrThrow(config, name);
        const bindings = listAuthBindings(spec).map((binding) => ({
          kind: binding.kind,
          key: binding.key,
          value: redactAuthValue(binding.value)
        }));

        return {
          server: name,
          transport: spec.transport,
          bindings
        };
      });

      if (options.json) {
        process.stdout.write(`${JSON.stringify({ auth: output }, null, 2)}\n`);
        return;
      }

      if (output.length === 0) {
        process.stdout.write("No upstream servers configured.\n");
        return;
      }

      for (const serverEntry of output) {
        process.stdout.write(`- ${serverEntry.server} (${serverEntry.transport})\n`);
        if (serverEntry.bindings.length === 0) {
          process.stdout.write("  (no auth bindings)\n");
          continue;
        }

        for (const binding of serverEntry.bindings) {
          process.stdout.write(`  ${binding.kind}:${binding.key} = ${binding.value}\n`);
        }
      }
    });

  auth
    .command("rotate-local-token")
    .description("Rotate bearer token used for local client->mcpx auth")
    .action(async () => {
      const secrets = new SecretsManager();
      secrets.rotateLocalToken("local_gateway_token");
      const config = loadConfig();
      await restartDaemon(config, process.argv[1] ?? "", secrets);
      process.stdout.write("Rotated local gateway token and restarted daemon.\n");
      process.stdout.write("No client configs were modified.\n");
      process.stdout.write("Run `mcpx sync <client>` (or `mcpx sync`) to update managed `mcpx` entries with the new token.\n");
    });
}

function registerClientsCommands(program: Command): void {
  const clients = program.command("clients").description("Client adapter utilities");

  clients
    .command("list")
    .option("--json", "Output JSON")
    .description("List supported clients and detected config paths")
    .action((options: { json?: boolean }) => {
      const payload = getAdapters().map((adapter) => ({
        id: adapter.id,
        supportsHttp: adapter.supportsHttp(),
        configPath: adapter.detectConfigPath()
      }));

      if (options.json) {
        process.stdout.write(`${JSON.stringify({ clients: payload }, null, 2)}\n`);
        return;
      }

      for (const client of payload) {
        process.stdout.write(`- ${client.id}: ${client.supportsHttp ? "HTTP" : "NO_HTTP"} ${client.configPath ?? "(unknown path)"}\n`);
      }
    });
}

function registerMcpCompat(program: Command): void {
  const mcp = program.command("mcp").description("Compatibility namespace for MCP commands");
  registerAddCommand(mcp);
  registerRemoveCommand(mcp);
  registerListCommand(mcp);
}

export async function runCli(argv = process.argv): Promise<void> {
  const program = new Command();
  program.name("mcpx").description("HTTP-first MCP gateway and multi-client installer").version("0.1.0");

  registerAddCommand(program);
  registerRemoveCommand(program);
  registerListCommand(program);
  registerSyncCommand(program);
  registerStatusCommand(program);
  registerDoctorCommand(program);
  registerDaemonCommands(program);
  registerSecretsCommands(program);
  registerAuthCommands(program);
  registerClientsCommands(program);
  registerMcpCompat(program);

  await program.parseAsync(argv);
}

void runCli().catch((error) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
});
