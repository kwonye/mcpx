import type { Command } from "commander";
import path from "node:path";
import { loadConfig } from "../core/config.js";
import { mutateConfig } from "../core/config-store.js";
import { SecretsManager } from "../core/secrets.js";
import { syncAllClients, persistSyncState } from "../core/sync.js";
import { exportEnvironment, importEnvironment } from "../core/share.js";
import type { CommandContext } from "./shared.js";

export function registerShare(program: Command, _ctx: CommandContext): void {
  const share = program.command("share").description("Export and import portable mcpx environments");
  share.command("export <directory>")
    .option("--skill <id>", "Only include this skill (repeatable)", (value: string, previous: string[] = []) => [...previous, value])
    .option("--plugin <id>", "Only include this plugin (repeatable)", (value: string, previous: string[] = []) => [...previous, value])
    .description("Export a Git-friendly environment folder")
    .action((directory: string, options: { skill?: string[]; plugin?: string[] }) => {
      try {
        const result = exportEnvironment(directory, { skills: options.skill, plugins: options.plugin });
        process.stdout.write(`Environment exported to ${path.resolve(directory)}\n`);
        process.stdout.write(`${result.environment.skills.length} skill(s), ${result.environment.plugins.length} plugin(s), ${Object.keys(result.environment.servers).length} server(s)\n`);
      } catch (error) {
        process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
    });
  share.command("import <directory>")
    .option("--dry-run", "Validate and preview without changing local state")
    .option("--locked", "Require manifest and package hashes to match the lockfile")
    .option("--input <name=value>", "Provide a recipient input", (value: string, previous: Record<string, string> = {}) => {
      const separator = value.indexOf("=");
      if (separator <= 0) throw new Error("Inputs must use name=value");
      return { ...previous, [value.slice(0, separator)]: value.slice(separator + 1) };
    }, {})
    .description("Import a portable environment folder")
    .action(async (directory: string, options: { dryRun?: boolean; locked?: boolean; input: Record<string, string> }) => {
      try {
        const result = await importEnvironment(directory, { dryRun: options.dryRun, locked: options.locked, inputs: options.input });
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        if (!options.dryRun) {
          const summary = syncAllClients(loadConfig(), new SecretsManager());
          await mutateConfig((freshConfig) => persistSyncState(summary, freshConfig));
        }
      } catch (error) {
        process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
    });
}
