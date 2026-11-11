import type { Command } from "commander";
import type { CommandContext } from "./shared.js";
import { loadStatusReport, printStatusReportText } from "./status-format.js";
import { runManagementTui } from "../core/tui.js";

export function registerStatus(program: Command, { cliPath }: CommandContext): void {
  program
    .command("status")
    .option("--no-interactive", "Disable interactive status menu")
    .option("--json", "Output JSON")
    .description("Show gateway, daemon, MCP inventory, and client sync status")
    .action(async (options: { json?: boolean; interactive?: boolean }) => {
      const report = await loadStatusReport();

      if (options.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        return;
      }

      const interactive = (options.interactive ?? true) && process.stdin.isTTY && process.stdout.isTTY;
      if (interactive) {
        await runManagementTui(cliPath);
        return;
      }

      printStatusReportText(report);
    });
}
