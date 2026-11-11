import type { Command } from "commander";
import { loadConfig } from "../core/config.js";
import { SecretsManager } from "../core/secrets.js";
import {
  getDaemonStatus,
  readDaemonLogs,
  restartDaemon,
  runDaemonForeground,
  startDaemon,
  stopDaemonAsync
} from "../core/daemon.js";
import type { CommandContext } from "./shared.js";

export function registerDaemon(program: Command, _ctx: CommandContext): void {
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
    .action(async () => {
      const result = await stopDaemonAsync();
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
