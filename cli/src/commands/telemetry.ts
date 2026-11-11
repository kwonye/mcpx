import type { Command } from "commander";
import {
  acknowledgeTelemetryNotice,
  getTelemetryStatus,
  loadTelemetryPreferences,
  resetTelemetryInstallationId,
  shutdownTelemetry,
  updateTelemetryPreferences
} from "../core/telemetry.js";
import { shutdownNodeErrorReporting } from "../core/error-reporting.js";
import type { CommandContext } from "./shared.js";

export function registerTelemetry(program: Command, _ctx: CommandContext): void {
  const telemetry = program.command("telemetry").description("Manage anonymous analytics and error reporting");

  telemetry
    .command("status")
    .description("Show telemetry preferences and effective status")
    .option("--json", "Print machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const status = getTelemetryStatus();
      if (options.json) {
        process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
        return;
      }
      process.stdout.write(`Usage analytics: ${status.usageAnalyticsEnabled ? "enabled" : "disabled"} (${status.usageActive ? "active" : "inactive"})\n`);
      process.stdout.write(`Error reporting: ${status.errorReportingEnabled ? "enabled" : "disabled"} (${status.errorsActive ? "active" : "inactive"})\n`);
      process.stdout.write(`Privacy notice: ${status.noticeAcknowledgedVersion >= 1 ? "acknowledged" : "needs review"}\n`);
      process.stdout.write(`Anonymous installation ID: ${status.installationId ? "set" : "not set"}\n`);
      if (status.blockedReason) process.stdout.write(`Inactive reason: ${status.blockedReason}\n`);
    });

  telemetry
    .command("enable [target]")
    .description("Enable usage analytics, error reporting, or all telemetry")
    .action((target?: string) => {
      const normalized = target ?? "all";
      if (!["usage", "errors", "all"].includes(normalized)) {
        throw new Error("Target must be usage, errors, or all.");
      }
      const current = loadTelemetryPreferences();
      const noticeWasAcknowledged = current.noticeAcknowledgedVersion >= 1;
      acknowledgeTelemetryNotice();
      updateTelemetryPreferences({
        usageAnalyticsEnabled: normalized === "usage" || normalized === "all"
          ? true
          : noticeWasAcknowledged
            ? current.usageAnalyticsEnabled
            : false,
        errorReportingEnabled: normalized === "errors" || normalized === "all"
          ? true
          : noticeWasAcknowledged
            ? current.errorReportingEnabled
            : false
      });
      process.stdout.write(`Telemetry enabled: ${normalized}.\n`);
    });

  telemetry
    .command("disable [target]")
    .description("Disable usage analytics, error reporting, or all telemetry")
    .action(async (target?: string) => {
      const normalized = target ?? "all";
      if (!["usage", "errors", "all"].includes(normalized)) {
        throw new Error("Target must be usage, errors, or all.");
      }
      const current = loadTelemetryPreferences();
      updateTelemetryPreferences({
        usageAnalyticsEnabled: normalized === "usage" || normalized === "all" ? false : current.usageAnalyticsEnabled,
        errorReportingEnabled: normalized === "errors" || normalized === "all" ? false : current.errorReportingEnabled
      });
      if (normalized === "errors" || normalized === "all") {
        await shutdownNodeErrorReporting(150);
      }
      process.stdout.write(`Telemetry disabled: ${normalized}.\n`);
    });

  telemetry
    .command("reset-id")
    .description("Reset the anonymous installation ID")
    .action(async () => {
      resetTelemetryInstallationId();
      await shutdownTelemetry();
      process.stdout.write("Anonymous installation ID reset.\n");
    });
}
