import type { Command } from "commander";
import { loadConfig } from "../core/config.js";
import { SecretsManager } from "../core/secrets.js";
import { synchronizeClients } from "../core/sync.js";
import { planSynchronization } from "../core/sync-plan.js";
import { planAdoption, applyAdoption } from "../core/adoption.js";
import { listHarnesses } from "../core/harnesses.js";
import type { ClientId } from "../types.js";
import { captureTelemetryEvent, durationBucket, markTelemetryMilestone } from "../core/telemetry.js";
import { ensureDaemonIfEnabled, ensureExitCodeForSyncFailures, printSyncSummary, type CommandContext } from "./shared.js";

export function parseClientList(values: string[] | undefined): ClientId[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }

  const normalized = values.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  const unique = Array.from(new Set(normalized));
  // Harness installation ids: every catalogued client plus `<client>@<project>` installations.
  const validClients = listHarnesses(loadConfig()).map((installation) => installation.id);
  for (const client of unique) {
    if (!validClients.includes(client)) {
      throw new Error(`Unknown client: ${client}. Valid clients: ${validClients.join(", ")}`);
    }
  }

  return unique as ClientId[];
}

export function registerSync(program: Command, { cliPath }: CommandContext): void {
  program
    .command("sync [clients...]")
    .option("--client <id>", "Limit sync to specific client(s), comma-separated or repeated", (value, prev: string[] = []) => [...prev, value], [])
    .option("--dry-run", "Preview synchronization without writing native configurations")
    .option("--import", "Also scan clients for unmanaged servers and adopt them into the mcpx catalog", false)
    .option("--json", "Output JSON")
    .description("Sync gateway configuration to supported clients (e.g. `mcpx sync claude`)")
    .action(async (clients: string[], options: { client: string[]; json?: boolean; import?: boolean; dryRun?: boolean }) => {
      const startedAt = Date.now();
      const targetClients = parseClientList([...(clients ?? []), ...(options.client ?? [])]);
      if (options.dryRun) { process.stdout.write(JSON.stringify(planSynchronization(targetClients), null, 2) + "\n"); return; }
      const secrets = new SecretsManager();
      await ensureDaemonIfEnabled(cliPath, secrets);
      // Under a control-service lease, imports go through the receipt-backed adoption flow.
      if (options.import && process.env.MCPX_CONTROL_CHILD === "1") {
        const plan = planAdoption(targetClients);
        if (plan.items.some(item => ["import", "reuse"].includes(item.action))) await applyAdoption(plan);
      }
      const summary = await synchronizeClients({ targetClients, importScan: options.import && process.env.MCPX_CONTROL_CHILD !== "1" }, secrets);
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
