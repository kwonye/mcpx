import type { Command } from "commander";
import { loadConfig } from "../core/config.js";
import { mutateConfig } from "../core/config-store.js";
import { SecretsManager } from "../core/secrets.js";
import { syncAllClients, persistSyncState } from "../core/sync.js";
import type { ClientId } from "../types.js";
import { STATUS_CLIENTS } from "../core/status.js";
import { captureTelemetryEvent, durationBucket, markTelemetryMilestone } from "../core/telemetry.js";
import { ensureDaemonIfEnabled, ensureExitCodeForSyncFailures, printSyncSummary, type CommandContext } from "./shared.js";

const VALID_CLIENTS: ClientId[] = STATUS_CLIENTS;

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

export function registerSync(program: Command, { cliPath }: CommandContext): void {
  program
    .command("sync [clients...]")
    .option("--client <id>", "Limit sync to specific client(s), comma-separated or repeated", (value, prev: string[] = []) => [...prev, value], [])
    .option("--import", "Also scan clients for unmanaged servers and adopt them into the mcpx catalog", false)
    .option("--json", "Output JSON")
    .description("Sync gateway configuration to supported clients (e.g. `mcpx sync claude`)")
    .action(async (clients: string[], options: { client: string[]; json?: boolean; import?: boolean }) => {
      const startedAt = Date.now();
      const config = loadConfig();
      const targetClients = parseClientList([...(clients ?? []), ...(options.client ?? [])]);
      const secrets = new SecretsManager();
      await ensureDaemonIfEnabled(cliPath, secrets);
      const summary = syncAllClients(config, secrets, { targetClients, importScan: options.import ?? false });
      await mutateConfig((freshConfig) => {
        persistSyncState(summary, freshConfig);
      });
      printSyncSummary(summary, options.json ?? false);
      ensureExitCodeForSyncFailures(summary.hasErrors);
      if (!summary.hasErrors) markTelemetryMilestone("first_sync_succeeded");
      captureTelemetryEvent({
        name: "operation_completed",
        properties: {
          operation: "client_sync",
          outcome: summary.hasErrors ? "failure" : "success",
          errorCode: summary.hasErrors ? "sync_error" : undefined,
          durationBucket: durationBucket(Date.now() - startedAt)
        }
      });
    });
}
