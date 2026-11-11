import type { Command } from "commander";
import { getAdapters } from "../adapters/index.js";
import type { CommandContext } from "./shared.js";

export function registerClients(program: Command, _ctx: CommandContext): void {
  const clients = program.command("clients").description("Client adapter utilities");

  clients
    .command("list")
    .option("--json", "Output JSON")
    .description("List supported clients and detected config paths")
    .action((options: { json?: boolean }) => {
      const payload = getAdapters().map((adapter) => ({
        id: adapter.id,
        supportsHttp: adapter.supportsHttp(),
        configPath: adapter.detectConfigPath()
      }));

      if (options.json) {
        process.stdout.write(`${JSON.stringify({ clients: payload }, null, 2)}\n`);
        return;
      }

      for (const client of payload) {
        process.stdout.write(`- ${client.id}: ${client.supportsHttp ? "HTTP" : "NO_HTTP"} ${client.configPath ?? "(unknown path)"}\n`);
      }
    });
}
