/**
 * Helpers shared by more than one command group.
 */
import { spawn } from "node:child_process";
import type { Interface as ReadlineInterface } from "node:readline/promises";
import { loadConfig, loadMergedConfig } from "../core/config.js";
import { mutateConfig } from "../core/config-store.js";
import { SecretsManager } from "../core/secrets.js";
import { syncAllClients, persistSyncState } from "../core/sync.js";
import type { McpxConfig, UpstreamServerSpec } from "../types.js";
import { removeAuthReference } from "../core/server-auth.js";
import { startDaemon } from "../core/daemon.js";
import { clearOAuthCredentials, isOAuthReference, oauthReferenceServerName } from "../core/oauth.js";

/** Per-invocation values every command module receives at registration. */
export interface CommandContext {
  /** Path of the running CLI entry script (argv[1]), used to spawn the daemon. */
  cliPath: string;
}

export function getServerSpecOrThrow(config: McpxConfig, serverName: string): UpstreamServerSpec {
  const spec = config.servers[serverName];
  if (!spec) {
    throw new Error(`Server "${serverName}" does not exist.`);
  }

  return spec;
}

export function ensureExitCodeForSyncFailures(hasErrors: boolean): void {
  if (hasErrors) {
    process.exitCode = 2;
  }
}

export function printSyncSummary(summary: ReturnType<typeof syncAllClients>, asJson = false): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  if (
    summary.imports.imported.length > 0
    || summary.imports.duplicates.length > 0
    || summary.imports.skipped.length > 0
    || summary.imports.conflicts.length > 0
    || summary.imports.errors.length > 0
  ) {
    process.stdout.write("Imports:\n");
    for (const entry of summary.imports.imported) {
      process.stdout.write(`- imported ${entry.serverName} from ${entry.clientId}`);
      if (entry.sourceEntryName !== entry.serverName) {
        process.stdout.write(` (${entry.sourceEntryName})`);
      }
      process.stdout.write("\n");
    }
    for (const entry of summary.imports.duplicates) {
      process.stdout.write(`- adopted existing ${entry.serverName} from ${entry.clientId}\n`);
    }
    for (const entry of summary.imports.skipped) {
      process.stdout.write(`- skipped ${entry.serverName} from ${entry.clientId} - ${entry.reason}\n`);
    }
    for (const entry of summary.imports.conflicts) {
      process.stdout.write(`- conflict ${entry.serverName} from ${entry.clientId} - ${entry.message}\n`);
    }
    for (const entry of summary.imports.errors) {
      process.stdout.write(`- import error ${entry.clientId} - ${entry.message}\n`);
    }
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
    if (result.driftedEntries && result.driftedEntries.length > 0) {
      process.stdout.write(`  (note: ${result.driftedEntries.length} manually-edited entr${result.driftedEntries.length === 1 ? "y was" : "ies were"} reset to mcpx-managed values: ${result.driftedEntries.join(", ")})\n`);
    }
  }
}

export async function ensureDaemonIfEnabled(cliPath: string, secrets: SecretsManager): Promise<void> {
  if (process.env.MCPX_SKIP_DAEMON_AUTOSTART === "1") {
    return;
  }

  const config = loadConfig();
  if (!config.gateway.autoStart) {
    return;
  }

  await startDaemon(config, cliPath, secrets);
}

export async function autoSyncManagedEntries(cliPath: string): Promise<void> {
  const secrets = new SecretsManager();
  await ensureDaemonIfEnabled(cliPath, secrets);
  // Reload fresh right before syncing (rather than trusting a snapshot the
  // caller may have loaded before an earlier config mutation completed), and
  // persist the resulting client-sync state through the config lock so this
  // never clobbers a concurrent mutation's changes with a stale save.
  const config = loadMergedConfig();
  const summary = syncAllClients(config, secrets);
  await mutateConfig((freshConfig) => {
    persistSyncState(summary, freshConfig);
  });
  printSyncSummary(summary, false);
  ensureExitCodeForSyncFailures(summary.hasErrors);
}

/**
 * Clears an OAuth-signed-in server's stored credentials and, if the server's
 * Authorization header is still bound to that OAuth reference, removes the
 * binding and re-syncs clients. Shared by `mcpx auth logout` and the
 * interactive status menu's "Sign out" action.
 */
export async function performOAuthLogout(
  serverName: string,
  spec: UpstreamServerSpec,
  secrets: SecretsManager
): Promise<{ removedSecrets: string[]; removedBinding: string | null; sync?: ReturnType<typeof syncAllClients> }> {
  // Clear credentials first: even if the binding removal below fails for
  // some reason, a server left pointing at a dangling oauth:// reference
  // with the old tokens gone is safer than one still holding live tokens.
  const removedSecrets = clearOAuthCredentials(serverName, secrets);

  let removedBinding: string | null = null;
  if (spec.transport === "http" && spec.headers?.Authorization && isOAuthReference(spec.headers.Authorization) && oauthReferenceServerName(spec.headers.Authorization) === serverName) {
    await mutateConfig((freshConfig) => {
      const freshSpec = getServerSpecOrThrow(freshConfig, serverName);
      removeAuthReference(freshSpec, { kind: "header", key: "Authorization" });
    });
    removedBinding = "Authorization";
  }

  let sync: ReturnType<typeof syncAllClients> | undefined;
  if (removedBinding) {
    const syncSourceConfig = loadConfig();
    sync = syncAllClients(syncSourceConfig, secrets);
    await mutateConfig((freshConfig) => {
      persistSyncState(sync!, freshConfig);
    });
  }

  return { removedSecrets, removedBinding, sync };
}

export async function promptLine(rl: ReadlineInterface, prompt: string): Promise<string> {
  return (await rl.question(prompt)).trim();
}

export async function promptLineWithDefault(rl: ReadlineInterface, prompt: string, defaultValue: string): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const value = (await rl.question(`${prompt}${suffix}: `)).trim();
  return value || defaultValue;
}

/**
 * Opens a URL in the user's default browser without blocking the event loop.
 * execFileSync used to be used here, but on Linux `xdg-open` can block until
 * the browser process itself exits, which stalls the CLI process and prevents
 * the loopback OAuth callback server from ever accepting the redirect. Falls
 * back to printing the URL if the platform opener can't be spawned (e.g. a
 * headless box with no `xdg-open`), so the flow can still be completed by hand.
 */
export function openInBrowser(url: string): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];

  const printFallback = () => {
    process.stdout.write(`Could not open a browser automatically. Open this URL to continue:\n${url}\n`);
  };

  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    // spawn failures (e.g. no `xdg-open` on this system) surface asynchronously via
    // the "error" event rather than a synchronous throw; an unhandled one would
    // crash the process, so it must be handled even though we don't otherwise care
    // about this child process's lifecycle.
    child.on("error", printFallback);
    child.unref();
  } catch {
    printFallback();
  }
}
