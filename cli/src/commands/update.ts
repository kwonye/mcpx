import type { Command } from "commander";
import { getStagedUpdate, checkForUpdates } from "../core/update.js";
import { performUpdate, performRollback } from "../core/update-manager.js";
import { captureTelemetryEvent, durationBucket } from "../core/telemetry.js";
import type { CommandContext } from "./shared.js";

export function registerUpdate(program: Command, _ctx: CommandContext): void {
  const update = program.command("update").description("Check for and install updates");

  update
    .command("check")
    .option("--json", "Output JSON")
    .description("Check for available updates")
    .action(async (options: { json?: boolean }) => {
      const startedAt = Date.now();
      const status = await checkForUpdates();
      captureTelemetryEvent({
        name: "operation_completed",
        properties: {
          operation: "update_check",
          outcome: status.error ? "failure" : "success",
          errorCode: status.error ? "update_check_failed" : undefined,
          durationBucket: durationBucket(Date.now() - startedAt)
        }
      });
      captureTelemetryEvent({
        name: "update_completed",
        properties: { action: "check", outcome: status.error ? "failure" : "success", fromVersion: status.currentVersion, toVersion: status.latestVersion ?? undefined }
      });

      if (options.json) {
        process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
        return;
      }

      process.stdout.write(`Current: ${status.currentVersion}\n`);
      if (status.latestVersion) {
        process.stdout.write(`Latest:  ${status.latestVersion}\n`);
        if (status.updateAvailable) {
          process.stdout.write("Status:  Update available. Run `mcpx update` to install.\n");
        } else {
          process.stdout.write("Status:  Up to date.\n");
        }
      } else {
        process.stdout.write(`Status:  Unable to check for updates.${status.error ? ` (${status.error})` : ""}\n`);
      }
    });

  update
    .command("install")
    .description("Download and stage the latest update")
    .action(async () => {
      const startedAt = Date.now();
      process.stdout.write("Checking for updates...\n");
      const result = await performUpdate();
      process.stdout.write(`${result.message}\n`);
      captureTelemetryEvent({
        name: "operation_completed",
        properties: { operation: "update_install", outcome: result.success ? "success" : "failure", errorCode: result.success ? undefined : "update_failed", durationBucket: durationBucket(Date.now() - startedAt) }
      });
      captureTelemetryEvent({
        name: "update_completed",
        properties: { action: "install", outcome: result.success ? "success" : "failure" }
      });
      if (!result.success) {
        process.exitCode = 1;
      }
    });

  update
    .command("rollback")
    .description("Roll back to the previously installed version")
    .action(() => {
      const startedAt = Date.now();
      const result = performRollback();
      process.stdout.write(`${result.message}\n`);
      captureTelemetryEvent({
        name: "operation_completed",
        properties: { operation: "update_rollback", outcome: result.success ? "success" : "failure", errorCode: result.success ? undefined : "rollback_failed", durationBucket: durationBucket(Date.now() - startedAt) }
      });
      captureTelemetryEvent({
        name: "update_completed",
        properties: { action: "rollback", outcome: result.success ? "success" : "failure" }
      });
      if (!result.success) {
        process.exitCode = 1;
      }
    });

  update
    .command("status")
    .description("Show current update status")
    .action(() => {
      const staged = getStagedUpdate();
      if (staged) {
        process.stdout.write(`Staged version: ${staged.version}\n`);
        process.stdout.write(`Staged at: ${staged.stagedAt}\n`);
        process.stdout.write("Status: Will activate on next run.\n");
      } else {
        process.stdout.write("No staged updates.\n");
      }
    });
}
