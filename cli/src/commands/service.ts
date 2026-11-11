import type { Command } from "commander";
import {
  getServiceStatus,
  installService,
  restartService,
  startService,
  stopService,
  uninstallService,
  type ServiceResult
} from "../service/index.js";
import type { CommandContext } from "./shared.js";

function report(result: ServiceResult, json: boolean | undefined): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${result.message}\n`);
    for (const warning of result.warnings) {
      process.stdout.write(`warning: ${warning}\n`);
    }
  }
  if (!result.ok) {
    process.exitCode = 1;
  }
}

export function registerService(program: Command, ctx: CommandContext): void {
  const service = program
    .command("service")
    .description("Run the mcpx gateway as a background service that starts at login");

  service
    .command("install")
    .option("--no-start", "Register the service without starting it")
    .option("--json", "Output JSON")
    .description("Register the gateway with the OS (launchd, systemd or Task Scheduler)")
    .action(async (options: { start: boolean; json?: boolean }) => {
      report(await installService({ cliPath: ctx.cliPath, start: options.start }), options.json);
    });

  const simple: Array<[string, string, () => Promise<ServiceResult>]> = [
    ["uninstall", "Remove the background service", () => uninstallService()],
    ["start", "Start the background service", () => startService()],
    ["stop", "Stop the background service", () => stopService()],
    ["restart", "Restart the background service", () => restartService()],
    ["status", "Show whether the service is installed and running", () => getServiceStatus()]
  ];

  for (const [name, description, run] of simple) {
    service
      .command(name)
      .option("--json", "Output JSON")
      .description(description)
      .action(async (options: { json?: boolean }) => {
        report(await run(), options.json);
      });
  }
}
