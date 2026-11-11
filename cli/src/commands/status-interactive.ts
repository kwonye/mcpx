/**
 * Interactive `mcpx status` menus: MCP list, per-server actions and auth wizards.
 */
import fs from "node:fs";
import path from "node:path";
import { createInterface, type Interface as ReadlineInterface } from "node:readline/promises";
import { loadConfig } from "../core/config.js";
import { mutateConfig, mutateProjectConfig } from "../core/config-store.js";
import { setServerEnabled } from "../core/registry.js";
import { SecretsManager } from "../core/secrets.js";
import { syncAllClients, persistSyncState } from "../core/sync.js";
import {
  applyAuthReference,
  defaultAuthSecretName,
  listAuthBindings,
  maybePrefixBearer,
  removeAuthReference,
  resolveAuthTarget,
  secretRefName,
  toSecretRef
} from "../core/server-auth.js";
import { restartDaemon } from "../core/daemon.js";
import type { StatusAuthBinding, StatusServerEntry } from "../core/status.js";
import { runOAuthLogin, isOAuthReference } from "../core/oauth.js";
import {
  autoSyncManagedEntries,
  getServerSpecOrThrow,
  openInBrowser,
  performOAuthLogout,
  printSyncSummary,
  promptLine,
  promptLineWithDefault
} from "./shared.js";
import { clearTerminalScreen, promptMenuSelection } from "./menu.js";
import {
  daemonEmoji,
  formatAuthSummary,
  formatDaemonState,
  listSyncedClientLabels,
  loadStatusReport,
  serverHealthEmoji
} from "./status-format.js";

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
  await mutateConfig((freshConfig) => {
    const freshSpec = getServerSpecOrThrow(freshConfig, serverName);
    applyAuthReference(freshSpec, target, toSecretRef(secretName));
  });

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

  let shouldDeleteSecret = false;
  if (selected.secretName) {
    const shouldDelete = (await promptLine(rl, `Delete stored secret "${selected.secretName}" too? (y/N): `)).toLowerCase();
    shouldDeleteSecret = shouldDelete === "y" || shouldDelete === "yes";
  }

  const removed = await mutateConfig((freshConfig) => {
    const freshSpec = getServerSpecOrThrow(freshConfig, serverName);
    return removeAuthReference(freshSpec, { kind: selected.kind, key: selected.key });
  });

  if (!removed) {
    process.stdout.write(`No auth binding found for ${selected.kind}:${selected.key}.\n`);
    return;
  }

  const secretName = secretRefName(removed);
  if (secretName) {
    if (shouldDeleteSecret) {
      new SecretsManager().removeSecret(secretName);
      process.stdout.write(`Removed binding and deleted ${secretName}.\n`);
    } else {
      process.stdout.write("Removed binding.\n");
    }
  } else {
    process.stdout.write("Removed inline binding.\n");
  }
}

async function signInWithBrowserInteractively(serverName: string): Promise<void> {
  const config = loadConfig();
  const spec = getServerSpecOrThrow(config, serverName);
  if (spec.transport !== "http") {
    process.stdout.write("OAuth login only supports HTTP servers.\n");
    return;
  }

  const secrets = new SecretsManager();
  await runOAuthLogin(serverName, spec, secrets, (url) => {
    process.stdout.write(`Opening browser to sign in to "${serverName}"...\n`);
    openInBrowser(url);
  });
  process.stdout.write(`OAuth login complete for "${serverName}".\n`);
}

async function signOutInteractively(rl: ReadlineInterface, serverName: string): Promise<void> {
  const confirmation = await promptLine(rl, `Sign out of "${serverName}"? (y/N): `);
  if (!["y", "yes"].includes(confirmation.trim().toLowerCase())) {
    process.stdout.write("Cancelled.\n");
    return;
  }

  const config = loadConfig();
  const spec = getServerSpecOrThrow(config, serverName);
  const secrets = new SecretsManager();
  const { removedSecrets, removedBinding } = await performOAuthLogout(serverName, spec, secrets);

  const bindingNote = removedBinding ? ` and the ${removedBinding} binding` : "";
  process.stdout.write(`Signed out of "${serverName}". Removed ${removedSecrets.length} stored credential${removedSecrets.length === 1 ? "" : "s"}${bindingNote}.\n`);
}

async function reconnectGatewayAndSync(cliPath: string): Promise<void> {
  const config = loadConfig();
  const secrets = new SecretsManager();
  const restart = await restartDaemon(config, cliPath, secrets);
  process.stdout.write(`${restart.message} pid=${restart.pid} port=${restart.port}\n`);
  const summary = syncAllClients(config, secrets);
  await mutateConfig((freshConfig) => {
    persistSyncState(summary, freshConfig);
  });
  printSyncSummary(summary, false);
}

async function setServerEnabledInteractively(
  rl: ReadlineInterface,
  serverName: string,
  enabled: boolean,
  cliPath: string
): Promise<boolean> {
  const action = enabled ? "enable" : "disable";
  const confirmation = await promptLine(rl, `Type "${serverName}" to ${action} this MCP (blank to cancel): `);
  if (confirmation !== serverName) {
    process.stdout.write("Cancelled.\n");
    return false;
  }

  if (serverName.includes(".")) {
    const parts = serverName.split(".");
    const projectName = parts[0];
    const baseServerName = parts.slice(1).join(".");
    
    const globalConfigForProjects = loadConfig();
    if (globalConfigForProjects.projects) {
      const projectEntry = Object.values(globalConfigForProjects.projects).find(p => p.name === projectName);
      if (projectEntry) {
        const localPath = path.join(projectEntry.path, ".mcpx.json");
        if (fs.existsSync(localPath)) {
          const handled = await mutateProjectConfig(localPath, (projectConfig) => {
            if (!projectConfig.servers[baseServerName]) {
              return false;
            }
            setServerEnabled(projectConfig as any, baseServerName, enabled);
            return true;
          });

          if (handled) {
            process.stdout.write(`${enabled ? "Enabled" : "Disabled"} server: ${serverName}\n`);
            process.stdout.write("Auto-syncing managed gateway entries across all supported clients...\n");
            await autoSyncManagedEntries(cliPath);
            return true;
          }
        }
      }
    }
  }

  await mutateConfig((freshConfig) => {
    setServerEnabled(freshConfig, serverName, enabled);
  });
  process.stdout.write(`${enabled ? "Enabled" : "Disabled"} server: ${serverName}\n`);
  process.stdout.write("Auto-syncing managed gateway entries across all supported clients...\n");
  await autoSyncManagedEntries(cliPath);
  return true;
}

function buildServerActionTitle(server: StatusServerEntry): string[] {
  const lines = [
    `${serverHealthEmoji(server)} ${server.name} MCP Server`,
    `State: ${server.enabled ? "enabled" : "disabled"}`,
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
  if (!server.enabled) {
    return "⏸️ disabled";
  }

  const managed = server.clients.filter((client) => client.managed);
  const errorCount = managed.filter((client) => client.status === "ERROR").length;
  const syncSummary = managed.length > 0
    ? `✅ ${managed.length} synced config${managed.length === 1 ? "" : "s"}`
    : "⚠️ not synced";
  const errorSummary = errorCount > 0 ? ` • ❌ ${errorCount} error` : "";
  const authSummary = server.authBindings.length > 0 ? "🔐 auth configured • " : "";

  return `${authSummary}${syncSummary}${errorSummary}`;
}

interface ServerMenuAction {
  label: string;
  detail: string;
  /** Return true to close the menu (e.g. after a disable/enable that already re-synced). */
  run: () => Promise<boolean | void>;
}

async function runServerActionsMenu(rl: ReadlineInterface, serverName: string, cliPath: string): Promise<void> {
  while (true) {
    const report = await loadStatusReport();
    const server = report.servers.find((entry) => entry.name === serverName);
    if (!server) {
      process.stdout.write(`Server "${serverName}" no longer exists.\n`);
      return;
    }

    const isOAuthBound = server.authBindings.some(
      (binding) => binding.kind === "header" && binding.key === "Authorization" && isOAuthReference(binding.value)
    );

    // Built as an array of {label, detail, run} rather than matched against a
    // positional index, since the entries below are conditional -- a fixed
    // "action === N" chain silently breaks the moment an entry is added or
    // removed above another one.
    const actions: ServerMenuAction[] = [
      {
        label: "🔐 Configure auth",
        detail: "Set or update auth binding for this MCP.",
        run: () => configureServerAuthInteractively(rl, serverName, false)
      }
    ];

    if (server.transport === "http" && !isOAuthBound) {
      actions.push({
        label: "🌐 Sign in with browser",
        detail: "Run OAuth login for this MCP.",
        run: () => signInWithBrowserInteractively(serverName)
      });
    }

    actions.push({
      label: "♻️ Re-authenticate",
      detail: "Replace token for an existing auth binding.",
      run: () => configureServerAuthInteractively(rl, serverName, true)
    });

    if (isOAuthBound) {
      actions.push({
        label: "🚪 Sign out",
        detail: "Clear stored OAuth credentials for this MCP.",
        run: () => signOutInteractively(rl, serverName)
      });
    }

    actions.push(
      {
        label: "🧹 Clear authentication",
        detail: "Remove a specific auth binding.",
        run: () => clearServerAuthInteractively(rl, serverName)
      },
      {
        label: server.enabled ? "⏸️ Disable" : "▶️ Enable",
        detail: "Toggle this MCP across mcpx and all synced clients.",
        run: () => setServerEnabledInteractively(rl, serverName, !server.enabled, cliPath)
      },
      {
        label: "🔄 Reconnect",
        detail: "Restart daemon and sync all managed client entries.",
        run: () => reconnectGatewayAndSync(cliPath)
      }
    );

    const backIndex = actions.length;
    const selection = await promptMenuSelection(
      rl,
      buildServerActionTitle(server),
      [...actions.map(({ label, detail }) => ({ label, detail })), { label: "← Back", detail: "Return to MCP list." }],
      "q"
    );

    if (selection === null || selection === backIndex) {
      return;
    }

    try {
      const shouldClose = await actions[selection].run();
      if (shouldClose === true) {
        return;
      }
    } catch (error) {
      process.stdout.write(`${(error as Error).message}\n`);
    }

    await promptLine(rl, "Press Enter to continue...");
  }
}

export async function runInteractiveStatusMenu(cliPath: string): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    while (true) {
      const report = await loadStatusReport();
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

      await runServerActionsMenu(rl, server.name, cliPath);
    }
  } finally {
    rl.close();
  }
}
