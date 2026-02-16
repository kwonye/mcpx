#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { emitKeypressEvents } from "node:readline";
import { createInterface, type Interface as ReadlineInterface } from "node:readline/promises";
import { loadConfig, saveConfig } from "./core/config.js";
import { addServer, removeServer } from "./core/registry.js";
import { SecretsManager, readSecretValueFromStdin } from "./core/secrets.js";
import { probeHttpAuthRequirement } from "./core/auth-probe.js";
import { syncAllClients } from "./core/sync.js";
import type { ClientId, ClientStatus, HttpServerSpec, McpxConfig, StdioServerSpec, UpstreamServerSpec } from "./types.js";
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
import { STATUS_CLIENTS, buildStatusReport, type StatusAuthBinding, type StatusReport, type StatusServerEntry } from "./core/status.js";
import { APP_VERSION } from "./version.js";

const VALID_CLIENTS: ClientId[] = STATUS_CLIENTS;

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

function isNegativeChoice(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "n" || normalized === "no";
}

async function maybeAutoConfigureAuthForAddedServer(
  serverName: string,
  spec: UpstreamServerSpec,
  secrets: SecretsManager
): Promise<void> {
  if (spec.transport !== "http") {
    return;
  }

  const probe = await probeHttpAuthRequirement(spec, secrets);
  if (!probe.authRequired) {
    return;
  }

  process.stdout.write(`Upstream "${serverName}" responded with ${probe.status ?? 401} and appears to require auth.\n`);
  if (probe.wwwAuthenticate) {
    process.stdout.write(`WWW-Authenticate: ${probe.wwwAuthenticate}\n`);
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write(`Run \`mcpx auth set ${serverName} --header Authorization --value \"<token>\"\` to configure auth.\n`);
    return;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const shouldConfigure = await promptLine(rl, "Configure auth now? (Y/n): ");
    if (isNegativeChoice(shouldConfigure)) {
      process.stdout.write("Skipping auth setup.\n");
      return;
    }

    const currentHeaderBinding = listAuthBindings(spec)
      .find((binding) => binding.kind === "header");
    const headerName = await promptLineWithDefault(rl, "Header name", currentHeaderBinding?.key ?? "Authorization");
    if (!headerName) {
      process.stdout.write("Skipping auth setup (empty header name).\n");
      return;
    }

    const authValueInput = await promptLine(rl, "Auth value/token (blank to skip): ");
    if (!authValueInput) {
      process.stdout.write("Skipping auth setup.\n");
      return;
    }

    const target = resolveAuthTarget(spec, headerName, undefined);
    const authValue = maybePrefixBearer(target, authValueInput, false);
    const existingValue = listAuthBindings(spec)
      .find((binding) => binding.kind === target.kind && binding.key === target.key)?.value;
    const defaultSecret = secretRefName(existingValue ?? "") ?? defaultAuthSecretName(serverName, target);
    const secretName = await promptLineWithDefault(rl, "Secret name", defaultSecret);

    if (!secretName) {
      process.stdout.write("Skipping auth setup (empty secret name).\n");
      return;
    }

    secrets.setSecret(secretName, authValue);
    applyAuthReference(spec, target, toSecretRef(secretName));
    process.stdout.write(`Configured auth via ${target.kind}:${target.key} using secret://${secretName}.\n`);
  } catch (error) {
    process.stdout.write(`Auto auth setup skipped: ${(error as Error).message}\n`);
    return;
  } finally {
    rl.close();
  }

  const verify = await probeHttpAuthRequirement(spec, secrets);
  if (verify.authRequired) {
    process.stdout.write("Auth is configured, but upstream still reports auth required. Re-auth may be needed.\n");
  } else if (verify.error) {
    process.stdout.write(`Auth check after setup could not be completed: ${verify.error}\n`);
  } else {
    process.stdout.write("Auth check passed.\n");
  }
}

function loadStatusReport(): StatusReport {
  const config = loadConfig();
  return buildStatusReport(config, loadManagedIndex(), getDaemonStatus(config));
}

interface MenuOption {
  label: string;
  detail?: string;
}

interface KeypressMeta {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
}

function daemonEmoji(running: boolean): string {
  return running ? "✅" : "⚠️";
}

function clientStatusEmoji(status: ClientStatus): string {
  if (status === "SYNCED") {
    return "✅";
  }

  if (status === "ERROR") {
    return "❌";
  }

  if (status === "UNSUPPORTED_HTTP") {
    return "⚠️";
  }

  return "⏭️";
}

function serverHealthEmoji(server: StatusServerEntry): string {
  const managed = server.clients.filter((client) => client.managed);
  if (managed.length === 0) {
    return "⚠️";
  }

  if (managed.some((client) => client.status === "ERROR")) {
    return "❌";
  }

  if (managed.some((client) => client.status === "UNSUPPORTED_HTTP")) {
    return "⚠️";
  }

  return "✅";
}

function formatDaemonState(status: StatusReport["daemon"]): string {
  if (status.running) {
    return `running (pid ${status.pid})`;
  }

  return "stopped";
}

function formatAuthSummary(authBindings: StatusServerEntry["authBindings"]): string {
  return authBindings.map((binding) => `${binding.kind}:${binding.key}`).join(", ");
}

function listSyncedClientLabels(server: StatusServerEntry): string[] {
  return server.clients
    .filter((client) => client.managed)
    .map((client) => (
      `${clientStatusEmoji(client.status)} ${client.configPath ? `${client.clientId} (${client.configPath})` : client.clientId}${
        client.status === "SYNCED" ? "" : ` [${client.status}]`
      }`
    ));
}

function printSyncedConfigBullets(server: StatusServerEntry, indent: string): void {
  const synced = listSyncedClientLabels(server);
  if (synced.length === 0) {
    process.stdout.write(`${indent}- ⚠️ none\n`);
    return;
  }

  for (const entry of synced) {
    process.stdout.write(`${indent}- ${entry}\n`);
  }
}

function printStatusReportText(report: StatusReport): void {
  process.stdout.write(`Gateway URL: ${report.gatewayUrl}\n`);
  process.stdout.write(`Daemon: ${daemonEmoji(report.daemon.running)} ${formatDaemonState(report.daemon)}\n`);
  process.stdout.write(`Upstream servers: ${report.upstreamCount}\n`);

  if (report.servers.length === 0) {
    process.stdout.write("⚠️ No upstream servers configured.\n");
  } else {
    for (const server of report.servers) {
      process.stdout.write(`- ${serverHealthEmoji(server)} ${server.name} (${server.transport})\n`);
      process.stdout.write(`  target: ${server.target}\n`);
      if (server.authBindings.length > 0) {
        process.stdout.write(`  auth: 🔐 ${formatAuthSummary(server.authBindings)}\n`);
      }
      process.stdout.write("  synced configs:\n");
      printSyncedConfigBullets(server, "  ");
    }
  }

  process.stdout.write("Client sync states:\n");
  for (const client of STATUS_CLIENTS) {
    const state = report.clients[client];
    if (!state) {
      process.stdout.write(`- ${clientStatusEmoji("SKIPPED")} ${client}: SKIPPED\n`);
    } else {
      process.stdout.write(`- ${clientStatusEmoji(state.status)} ${client}: ${state.status}${state.message ? ` - ${state.message}` : ""}\n`);
    }
  }
}

async function promptLine(rl: ReadlineInterface, prompt: string): Promise<string> {
  return (await rl.question(prompt)).trim();
}

async function promptLineWithDefault(rl: ReadlineInterface, prompt: string, defaultValue: string): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const value = (await rl.question(`${prompt}${suffix}: `)).trim();
  return value || defaultValue;
}

function parseSelection(value: string, max: number): number | null {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > max) {
    return null;
  }

  return numeric - 1;
}

function clearTerminalScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

function renderMenuScreen(titleLines: string[], options: MenuOption[], selectedIndex: number, cancelHint: string): void {
  clearTerminalScreen();

  for (const line of titleLines) {
    process.stdout.write(`${line}\n`);
  }
  process.stdout.write("\n");

  options.forEach((option, index) => {
    const cursor = index === selectedIndex ? "❯" : " ";
    process.stdout.write(`${cursor} ${index + 1}. ${option.label}\n`);
    if (option.detail) {
      process.stdout.write(`   ${option.detail}\n`);
    }
  });

  process.stdout.write(`\n↑/↓ to navigate • Space/Enter to select • Esc/${cancelHint} to cancel\n`);
}

async function promptMenuSelection(
  rl: ReadlineInterface,
  titleLines: string[],
  options: MenuOption[],
  cancelHint = "q"
): Promise<number | null> {
  if (options.length === 0) {
    return null;
  }

  const stdin = process.stdin as NodeJS.ReadStream;
  const canUseKeyNavigation = process.stdin.isTTY && process.stdout.isTTY && typeof stdin.setRawMode === "function";

  if (!canUseKeyNavigation) {
    for (const line of titleLines) {
      process.stdout.write(`${line}\n`);
    }
    process.stdout.write("\n");
    options.forEach((option, index) => {
      process.stdout.write(`${index + 1}. ${option.label}\n`);
      if (option.detail) {
        process.stdout.write(`   ${option.detail}\n`);
      }
    });
    const selected = parseSelection(
      await promptLine(rl, `Select option (1-${options.length}, blank to cancel): `),
      options.length
    );
    return selected;
  }

  return new Promise<number | null>((resolve) => {
    let index = 0;
    let settled = false;
    rl.pause();

    const cleanup = () => {
      stdin.off("keypress", onKeypress as never);
      try {
        stdin.setRawMode(false);
      } catch {
        // ignore cleanup errors
      }
      rl.resume();
    };

    const done = (value: number | null) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      process.stdout.write("\n");
      resolve(value);
    };

    const onKeypress = (_chunk: string, key: KeypressMeta) => {
      if (key.ctrl && key.name === "c") {
        done(null);
        return;
      }

      if (key.name === "up" || key.name === "k") {
        index = (index - 1 + options.length) % options.length;
        renderMenuScreen(titleLines, options, index, cancelHint);
        return;
      }

      if (key.name === "down" || key.name === "j") {
        index = (index + 1) % options.length;
        renderMenuScreen(titleLines, options, index, cancelHint);
        return;
      }

      if (key.name === "return" || key.name === "space") {
        done(index);
        return;
      }

      if (key.name === "escape" || key.name === "q") {
        done(null);
        return;
      }

      if (key.sequence && /^[1-9]$/.test(key.sequence)) {
        const numeric = Number(key.sequence);
        if (numeric >= 1 && numeric <= options.length) {
          done(numeric - 1);
        }
      }
    };

    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("keypress", onKeypress as never);

    renderMenuScreen(titleLines, options, index, cancelHint);
  });
}

async function chooseAuthBinding(
  rl: ReadlineInterface,
  bindings: StatusAuthBinding[],
  prompt: string
): Promise<StatusAuthBinding | null> {
  if (bindings.length === 0) {
    return null;
  }

  if (bindings.length === 1) {
    return bindings[0];
  }

  const selected = await promptMenuSelection(
    rl,
    ["Auth bindings", prompt],
    bindings.map((binding) => ({
      label: `${binding.kind}:${binding.key}`,
      detail: binding.secretName ? `source: secret://${binding.secretName}` : "source: <inline>"
    })),
    "q"
  );
  if (selected === null) {
    return null;
  }

  return bindings[selected] ?? null;
}

async function configureServerAuthInteractively(
  rl: ReadlineInterface,
  serverName: string,
  reauthOnly = false
): Promise<void> {
  const config = loadConfig();
  const spec = getServerSpecOrThrow(config, serverName);
  const existingBindings = listAuthBindings(spec);

  let targetKind: "header" | "env";
  let targetKey: string;
  let existingValue: string | undefined;

  if (reauthOnly) {
    const selected = await chooseAuthBinding(
      rl,
      existingBindings.map((binding) => ({
        kind: binding.kind,
        key: binding.key,
        value: binding.value,
        secretName: secretRefName(binding.value) ?? undefined
      })),
      "Choose binding to re-authenticate"
    );

    if (!selected) {
      process.stdout.write("No auth binding selected.\n");
      return;
    }

    targetKind = selected.kind;
    targetKey = selected.key;
    existingValue = selected.value;
  } else if (spec.transport === "http") {
    targetKind = "header";
    targetKey = await promptLineWithDefault(
      rl,
      "Header name",
      existingBindings.find((binding) => binding.kind === "header")?.key ?? "Authorization"
    );
  } else {
    targetKind = "env";
    targetKey = await promptLineWithDefault(
      rl,
      "Env var name",
      existingBindings.find((binding) => binding.kind === "env")?.key ?? ""
    );
  }

  if (!targetKey) {
    process.stdout.write("Auth key cannot be empty.\n");
    return;
  }

  const target = targetKind === "header"
    ? resolveAuthTarget(spec, targetKey, undefined)
    : resolveAuthTarget(spec, undefined, targetKey);

  if (!existingValue) {
    existingValue = existingBindings.find((binding) => binding.kind === target.kind && binding.key === target.key)?.value;
  }

  const token = await promptLine(rl, "Auth value/token (blank to cancel): ");
  if (!token) {
    process.stdout.write("Cancelled.\n");
    return;
  }

  const authValue = maybePrefixBearer(target, token, false);
  const defaultSecret = secretRefName(existingValue ?? "") ?? defaultAuthSecretName(serverName, target);
  const secretName = await promptLineWithDefault(rl, "Secret name", defaultSecret);
  if (!secretName) {
    process.stdout.write("Secret name cannot be empty.\n");
    return;
  }

  const secrets = new SecretsManager();
  secrets.setSecret(secretName, authValue);
  applyAuthReference(spec, target, toSecretRef(secretName));
  saveConfig(config);

  process.stdout.write(`Configured auth for "${serverName}" at ${target.kind}:${target.key} using secret://${secretName}.\n`);
}

async function clearServerAuthInteractively(rl: ReadlineInterface, serverName: string): Promise<void> {
  const config = loadConfig();
  const spec = getServerSpecOrThrow(config, serverName);
  const bindings = listAuthBindings(spec).map((binding) => ({
    kind: binding.kind,
    key: binding.key,
    value: binding.value,
    secretName: secretRefName(binding.value) ?? undefined
  }));

  const selected = await chooseAuthBinding(rl, bindings, "Choose binding to clear");
  if (!selected) {
    process.stdout.write("No auth binding selected.\n");
    return;
  }

  const removed = removeAuthReference(spec, {
    kind: selected.kind,
    key: selected.key
  });

  if (!removed) {
    process.stdout.write(`No auth binding found for ${selected.kind}:${selected.key}.\n`);
    return;
  }

  const secretName = secretRefName(removed);
  if (secretName) {
    const shouldDelete = (await promptLine(rl, `Delete keychain secret "${secretName}" too? (y/N): `)).toLowerCase();
    if (shouldDelete === "y" || shouldDelete === "yes") {
      new SecretsManager().removeSecret(secretName);
      process.stdout.write(`Removed binding and deleted ${secretName}.\n`);
    } else {
      process.stdout.write("Removed binding.\n");
    }
  } else {
    process.stdout.write("Removed inline binding.\n");
  }

  saveConfig(config);
}

async function reconnectGatewayAndSync(): Promise<void> {
  const config = loadConfig();
  const secrets = new SecretsManager();
  const restart = await restartDaemon(config, process.argv[1] ?? "", secrets);
  process.stdout.write(`${restart.message} pid=${restart.pid} port=${restart.port}\n`);
  const summary = syncAllClients(config, secrets);
  printSyncSummary(summary, false);
}

async function disableServerInteractively(rl: ReadlineInterface, serverName: string): Promise<boolean> {
  const confirmation = await promptLine(rl, `Type "${serverName}" to disable this MCP (blank to cancel): `);
  if (confirmation !== serverName) {
    process.stdout.write("Cancelled.\n");
    return false;
  }

  const config = loadConfig();
  removeServer(config, serverName, false);
  saveConfig(config);
  process.stdout.write(`Removed server: ${serverName}\n`);
  process.stdout.write("Auto-syncing managed gateway entries across all supported clients...\n");
  await autoSyncManagedEntries(config);
  return true;
}

function buildServerActionTitle(server: StatusServerEntry): string[] {
  const lines = [
    `${serverHealthEmoji(server)} ${server.name} MCP Server`,
    `Transport: ${server.transport}`,
    `Target: ${server.target}`,
    "Synced configs:"
  ];

  if (server.authBindings.length > 0) {
    lines.splice(3, 0, `Auth: 🔐 ${formatAuthSummary(server.authBindings)}`);
  }

  const synced = listSyncedClientLabels(server);
  if (synced.length === 0) {
    lines.push("  - ⚠️ none");
  } else {
    for (const entry of synced) {
      lines.push(`  - ${entry}`);
    }
  }

  return lines;
}

function buildServerMenuDetail(server: StatusServerEntry): string {
  const managed = server.clients.filter((client) => client.managed);
  const errorCount = managed.filter((client) => client.status === "ERROR").length;
  const syncSummary = managed.length > 0
    ? `✅ ${managed.length} synced config${managed.length === 1 ? "" : "s"}`
    : "⚠️ not synced";
  const errorSummary = errorCount > 0 ? ` • ❌ ${errorCount} error` : "";
  const authSummary = server.authBindings.length > 0 ? "🔐 auth configured • " : "";

  return `${authSummary}${syncSummary}${errorSummary}`;
}

async function runServerActionsMenu(rl: ReadlineInterface, serverName: string): Promise<void> {
  while (true) {
    const report = loadStatusReport();
    const server = report.servers.find((entry) => entry.name === serverName);
    if (!server) {
      process.stdout.write(`Server "${serverName}" no longer exists.\n`);
      return;
    }

    const action = await promptMenuSelection(
      rl,
      buildServerActionTitle(server),
      [
        { label: "🔐 Configure auth", detail: "Set or update auth binding for this MCP." },
        { label: "♻️ Re-authenticate", detail: "Replace token for an existing auth binding." },
        { label: "🧹 Clear authentication", detail: "Remove a specific auth binding." },
        { label: "🔄 Reconnect", detail: "Restart daemon and sync all managed client entries." },
        { label: "🚫 Disable", detail: "Remove this MCP and sync removals to clients." },
        { label: "← Back", detail: "Return to MCP list." }
      ],
      "q"
    );

    if (action === null || action === 5) {
      return;
    }

    try {
      if (action === 0) {
        await configureServerAuthInteractively(rl, serverName, false);
      } else if (action === 1) {
        await configureServerAuthInteractively(rl, serverName, true);
      } else if (action === 2) {
        await clearServerAuthInteractively(rl, serverName);
      } else if (action === 3) {
        await reconnectGatewayAndSync();
      } else if (action === 4) {
        const removed = await disableServerInteractively(rl, serverName);
        if (removed) {
          return;
        }
      }
    } catch (error) {
      process.stdout.write(`${(error as Error).message}\n`);
    }

    await promptLine(rl, "Press Enter to continue...");
  }
}

async function runInteractiveStatusMenu(): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    while (true) {
      const report = loadStatusReport();
      if (report.servers.length === 0) {
        clearTerminalScreen();
        process.stdout.write("mcpx status\n");
        process.stdout.write(`Gateway: ${report.gatewayUrl}\n`);
        process.stdout.write(`Daemon: ${daemonEmoji(report.daemon.running)} ${formatDaemonState(report.daemon)}\n`);
        process.stdout.write("⚠️ No upstream servers configured.\n");
        return;
      }

      const selection = await promptMenuSelection(
        rl,
        [
          "mcpx status",
          `Gateway: ${report.gatewayUrl}`,
          `Daemon: ${daemonEmoji(report.daemon.running)} ${formatDaemonState(report.daemon)}`,
          `MCP servers: ${report.upstreamCount}`,
          "Choose an MCP to manage:"
        ],
        report.servers.map((server) => ({
          label: `${serverHealthEmoji(server)} ${server.name} (${server.transport})`,
          detail: buildServerMenuDetail(server)
        })),
        "q"
      );

      if (selection === null) {
        return;
      }

      const server = report.servers[selection];
      if (!server) {
        continue;
      }

      await runServerActionsMenu(rl, server.name);
    }
  } finally {
    rl.close();
  }
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
      await maybeAutoConfigureAuthForAddedServer(parsed.name, parsed.spec, new SecretsManager());
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
    .option("--no-interactive", "Disable interactive status menu")
    .option("--json", "Output JSON")
    .description("Show gateway, daemon, MCP inventory, and client sync status")
    .action(async (options: { json?: boolean; interactive?: boolean }) => {
      const report = loadStatusReport();

      if (options.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        return;
      }

      const interactive = (options.interactive ?? true) && process.stdin.isTTY && process.stdout.isTTY;
      if (interactive) {
        await runInteractiveStatusMenu();
        return;
      }

      printStatusReportText(report);
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
  program.name("mcpx").description("HTTP-first MCP gateway and multi-client installer").version(APP_VERSION);

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
