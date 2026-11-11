/**
 * Status report loading and text formatting, shared by `mcpx status` and its interactive menu.
 */
import { loadMergedConfig } from "../core/config.js";
import type { ClientStatus } from "../types.js";
import { getDaemonStatus } from "../core/daemon.js";
import { loadManagedIndex } from "../core/managed-index.js";
import { getAdapters } from "../adapters/index.js";
import { buildStatusReport, type StatusReport, type StatusServerEntry } from "../core/status.js";

export async function loadStatusReport(): Promise<StatusReport> {
  const config = loadMergedConfig();
  return await buildStatusReport(config, loadManagedIndex(), getDaemonStatus(config));
}

export function daemonEmoji(running: boolean): string {
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

export function serverHealthEmoji(server: StatusServerEntry): string {
  if (!server.enabled) {
    return "⏸️";
  }

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

export function formatDaemonState(status: StatusReport["daemon"]): string {
  if (status.running) {
    return `running (pid ${status.pid})`;
  }

  return "stopped";
}

export function formatAuthSummary(authBindings: StatusServerEntry["authBindings"]): string {
  return authBindings.map((binding) => `${binding.kind}:${binding.key}`).join(", ");
}

export function listSyncedClientLabels(server: StatusServerEntry): string[] {
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

function formatTokenApprox(tokens: number): string {
  if (tokens === 0) return "0";
  if (tokens > 0 && tokens < 500) return "<1k";
  const thousands = Math.round(tokens / 1000);
  if (thousands === 0) return "<1k";
  return `~${thousands}k`;
}

export function printStatusReportText(report: StatusReport): void {
  process.stdout.write(`Gateway URL: ${report.gatewayUrl}\n`);
  process.stdout.write(`Daemon: ${daemonEmoji(report.daemon.running)} ${formatDaemonState(report.daemon)}\n`);
  process.stdout.write(`Upstream servers: ${report.upstreamCount}\n`);
  if (report.daemon.running) {
    process.stdout.write(`Global active tokens: ${formatTokenApprox(report.totalGlobalTokens ?? 0)}\n`);
  }

  if (report.servers.length === 0) {
    process.stdout.write("⚠️ No upstream servers configured.\n");
  } else {
    for (const server of report.servers) {
      const tokenSuffix = (server.enabled && server.tokenCount)
        ? ` [tokens: ${formatTokenApprox(server.tokenCount.total)} (tools: ${server.tokenCount.tools}, resources: ${server.tokenCount.resources}, prompts: ${server.tokenCount.prompts})]`
        : "";
      process.stdout.write(`- ${serverHealthEmoji(server)} ${server.name} (${server.transport})${tokenSuffix}\n`);
      process.stdout.write(`  state: ${server.enabled ? "enabled" : "disabled"}\n`);
      process.stdout.write(`  target: ${server.target}\n`);
      if (server.authBindings.length > 0) {
        process.stdout.write(`  auth: 🔐 ${formatAuthSummary(server.authBindings)}\n`);
      }
      process.stdout.write("  synced configs:\n");
      printSyncedConfigBullets(server, "  ");
    }
  }

  if (report.projects && Object.keys(report.projects).length > 0 && report.daemon.running) {
    process.stdout.write("Project active tokens:\n");
    for (const project of Object.values(report.projects)) {
      const projectTokens = report.totalProjectTokens?.[project.path] ?? 0;
      process.stdout.write(`- ${project.name}: ${formatTokenApprox(projectTokens)} tokens (${project.path})\n`);
    }
  }

  process.stdout.write("Client sync states:\n");
  for (const client of new Set([...getAdapters().map(adapter => adapter.id), ...Object.keys(report.clients)])) {
    const state = report.clients[client];
    if (!state) {
      process.stdout.write(`- ${clientStatusEmoji("SKIPPED")} ${client}: SKIPPED\n`);
    } else {
      process.stdout.write(`- ${clientStatusEmoji(state.status)} ${client}: ${state.status}${state.message ? ` - ${state.message}` : ""}\n`);
    }
  }
}
