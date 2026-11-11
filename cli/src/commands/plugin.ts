/**
 * Plugin management, including the `plugin marketplace` subgroup.
 */
import type { Command } from "commander";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { loadConfig } from "../core/config.js";
import { captureTelemetryEvent, durationBucket } from "../core/telemetry.js";
import { promptLine, type CommandContext } from "./shared.js";
import { recordTelemetryOperationFailure } from "./telemetry-support.js";

const PLUGIN_COMPONENTS = ["mcpServers", "skills", "hooks", "agents", "commands"] as const;

export function registerPlugin(program: Command, _ctx: CommandContext): void {
  const plugin = program.command("plugin").description("Manage plugins");

  plugin
    .command("inspect <source>")
    .description("Inspect plugin manifest and components")
    .action(async (source: string) => {
      const { inspectPlugin } = await import("../core/plugin-manager.js");
      try {
        const info = await inspectPlugin(source);
        process.stdout.write(JSON.stringify(info, null, 2) + "\n");
      } catch (e: any) {
        process.stderr.write(`Error: ${e.message}\n`);
        process.exit(1);
      }
    });

  plugin
    .command("install <source>")
    .option("--name <name>", "Plugin name")
    .option("--no-enable", "Don't enable plugin after install")
    .option("-y, --yes", "Confirm marketplace plugin installation")
    .description("Install plugin")
    .action(async (source: string, options: { name?: string; enable?: boolean; yes?: boolean }) => {
      const startedAt = Date.now();
      try {
        const config = loadConfig();
        const marketplaceName = source.includes("@") ? source.slice(source.lastIndexOf("@") + 1) : "";
        let p;
        if (config.marketplaces?.[marketplaceName]) {
          const { inspectMarketplacePlugin, installMarketplacePlugin } = await import("../core/marketplace.js");
          const detail = await inspectMarketplacePlugin(source);
          process.stdout.write(`${detail.displayName} (${source})\n`);
          process.stdout.write(`Will install: ${detail.supportedCapabilities.join(", ") || "nothing compatible"}\n`);
          if (detail.unsupportedCapabilities.length) process.stdout.write(`Unsupported: ${detail.unsupportedCapabilities.join(", ")}\n`);
          if (!detail.compatible) throw new Error(`Plugin ${source} has no mcpx-compatible capabilities`);
          if (!options.yes) {
            if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Marketplace installation requires --yes in non-interactive mode");
            const rl = createInterface({ input: process.stdin, output: process.stdout });
            try {
              const answer = await promptLine(rl, "Install this plugin? (y/N): ");
              if (answer.trim().toLowerCase() !== "y" && answer.trim().toLowerCase() !== "yes") {
                process.stdout.write("Installation cancelled.\n");
                return;
              }
            } finally {
              rl.close();
            }
          }
          p = await installMarketplacePlugin(source);
        } else {
          const { installPlugin } = await import("../core/plugin-manager.js");
          p = await installPlugin(source, { name: options.name, enabled: options.enable !== false });
        }
        process.stdout.write(`Plugin installed: ${p.id}\n`);
        captureTelemetryEvent({
          name: "operation_completed",
          properties: { operation: "plugin_install", outcome: "success", durationBucket: durationBucket(Date.now() - startedAt) }
        });
      } catch (e: any) {
        process.stderr.write(`Error: ${e.message}\n`);
        recordTelemetryOperationFailure("plugin_install", e, startedAt);
        process.exitCode = 1;
      }
    });

  const marketplace = plugin.command("marketplace").description("Manage plugin marketplaces");

  marketplace
    .command("list")
    .description("List configured plugin marketplaces")
    .action(async () => {
      const { listMarketplaces } = await import("../core/marketplace.js");
      process.stdout.write(JSON.stringify(await listMarketplaces(), null, 2) + "\n");
    });

  marketplace
    .command("add <source>")
    .option("--manifest <path>", "Marketplace manifest path inside the source")
    .description("Add a Claude or Codex plugin marketplace")
    .action(async (source: string, options: { manifest?: string }) => {
      const startedAt = Date.now();
      try {
        const { addMarketplace } = await import("../core/marketplace.js");
        const added = await addMarketplace(source, options.manifest);
        process.stdout.write(`Marketplace added: ${added.name}\n`);
        captureTelemetryEvent({
          name: "operation_completed",
          properties: { operation: "marketplace_add", outcome: "success", durationBucket: durationBucket(Date.now() - startedAt) }
        });
      } catch (error) {
        process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
        recordTelemetryOperationFailure("marketplace_add", error, startedAt);
        process.exitCode = 1;
      }
    });

  marketplace
    .command("update [name]")
    .description("Refresh one marketplace, or every configured marketplace")
    .action(async (name?: string) => {
      const startedAt = Date.now();
      try {
        const { listMarketplaces, refreshMarketplaceWithPlugins } = await import("../core/marketplace.js");
        const names = name ? [name] : (await listMarketplaces()).map((entry) => entry.name);
        for (const marketplaceName of names) {
          const result = await refreshMarketplaceWithPlugins(marketplaceName);
          process.stdout.write(`Marketplace updated: ${marketplaceName} (${result.updated.length} plugin update(s))\n`);
          for (const error of result.errors) process.stderr.write(`Warning: ${error}\n`);
        }
        captureTelemetryEvent({
          name: "operation_completed",
          properties: { operation: "marketplace_refresh", outcome: "success", durationBucket: durationBucket(Date.now() - startedAt) }
        });
      } catch (error) {
        process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
        recordTelemetryOperationFailure("marketplace_refresh", error, startedAt);
        process.exitCode = 1;
      }
    });

  marketplace
    .command("remove <name>")
    .option("-y, --yes", "Confirm removal and uninstall marketplace plugins")
    .description("Remove a custom marketplace and its installed plugins")
    .action(async (name: string, options: { yes?: boolean }) => {
      const startedAt = Date.now();
      try {
        if (!options.yes) {
          if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Marketplace removal requires --yes in non-interactive mode");
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          try {
            const answer = await promptLine(rl, `Remove ${name} and uninstall its plugins? (y/N): `);
            if (!["y", "yes"].includes(answer.trim().toLowerCase())) return;
          } finally {
            rl.close();
          }
        }
        const { removeMarketplace } = await import("../core/marketplace.js");
        await removeMarketplace(name);
        process.stdout.write(`Marketplace removed: ${name}\n`);
        captureTelemetryEvent({
          name: "operation_completed",
          properties: { operation: "marketplace_remove", outcome: "success", durationBucket: durationBucket(Date.now() - startedAt) }
        });
      } catch (error) {
        process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
        recordTelemetryOperationFailure("marketplace_remove", error, startedAt);
        process.exitCode = 1;
      }
    });

  plugin
    .command("discover [query]")
    .option("--marketplace <name>", "Filter by marketplace")
    .option("--category <category>", "Filter by category")
    .description("Browse available marketplace plugins")
    .action(async (query: string | undefined, options: { marketplace?: string; category?: string }) => {
      const { listMarketplacePlugins } = await import("../core/marketplace.js");
      let listings = await listMarketplacePlugins(query);
      if (options.marketplace) listings = listings.filter((entry) => entry.marketplace === options.marketplace);
      if (options.category) listings = listings.filter((entry) => entry.category?.toLowerCase() === options.category!.toLowerCase());
      process.stdout.write(JSON.stringify(listings, null, 2) + "\n");
    });

  plugin
    .command("details <plugin>")
    .description("Inspect a plugin@marketplace listing")
    .action(async (qualified: string) => {
      try {
        const { inspectMarketplacePlugin } = await import("../core/marketplace.js");
        process.stdout.write(JSON.stringify(await inspectMarketplacePlugin(qualified), null, 2) + "\n");
      } catch (error) {
        process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
    });

  plugin
    .command("approve <name> <component>")
    .description("Approve a plugin component (hooks, mcpServers)")
    .action(async (name: string, component: string) => {
      const { approvePluginComponent } = await import("../core/plugin-manager.js");
      try {
        await approvePluginComponent(name, component);
        process.stdout.write(`Approved ${component} for plugin ${name}\n`);
      } catch (e: any) {
        process.stderr.write(`Error: ${e.message}\n`);
        process.exit(1);
      }
    });

  plugin
    .command("pin <name>")
    .description("Pin a plugin at its current revision")
    .action(async (name: string) => {
      const { pinPlugin } = await import("../core/plugin-manager.js");
      await pinPlugin(name);
      process.stdout.write(`Plugin pinned: ${name}\n`);
    });

  plugin
    .command("unpin <name>")
    .description("Allow a pinned plugin to update")
    .action(async (name: string) => {
      const { unpinPlugin } = await import("../core/plugin-manager.js");
      await unpinPlugin(name);
      process.stdout.write(`Plugin unpinned: ${name}\n`);
    });

  plugin
    .command("rollback <name>")
    .description("Restore the previous installed plugin revision")
    .action(async (name: string) => {
      try {
        const { rollbackPlugin } = await import("../core/plugin-manager.js");
        const plugin = await rollbackPlugin(name);
        process.stdout.write(`Plugin rolled back: ${plugin.name}\n`);
      } catch (error) {
        process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
    });

  plugin
    .command("prepare <name>")
    .description("Install plugin dependencies")
    .action(async (name: string) => {
      const { preparePlugin } = await import("../core/plugin-manager.js");
      try {
        await preparePlugin(name);
        process.stdout.write(`Plugin ${name} prepared\n`);
      } catch (e: any) {
        process.stderr.write(`Error: ${e.message}\n`);
        process.exit(1);
      }
    });

  plugin
    .command("update <name>")
    .description("Update plugin to latest version")
    .action(async (name: string) => {
      const startedAt = Date.now();
      const { updatePlugin } = await import("../core/plugin-manager.js");
      try {
        const p = await updatePlugin(name);
        process.stdout.write(`Plugin ${name} updated to ${p.version}\n`);
        captureTelemetryEvent({
          name: "operation_completed",
          properties: { operation: "plugin_update", outcome: "success", durationBucket: durationBucket(Date.now() - startedAt) }
        });
      } catch (e: any) {
        process.stderr.write(`Error: ${e.message}\n`);
        recordTelemetryOperationFailure("plugin_update", e, startedAt);
        process.exitCode = 1;
      }
    });

  plugin
    .command("uninstall <name>")
    .option("--keep-data", "Keep plugin data after uninstall")
    .description("Uninstall plugin")
    .action(async (name: string, options: { keepData?: boolean }) => {
      const startedAt = Date.now();
      const { uninstallPlugin } = await import("../core/plugin-manager.js");
      try {
        await uninstallPlugin(name, options.keepData || false);
        process.stdout.write(`Plugin ${name} uninstalled\n`);
        captureTelemetryEvent({
          name: "operation_completed",
          properties: { operation: "plugin_uninstall", outcome: "success", durationBucket: durationBucket(Date.now() - startedAt) }
        });
      } catch (e: any) {
        process.stderr.write(`Error: ${e.message}\n`);
        recordTelemetryOperationFailure("plugin_uninstall", e, startedAt);
        process.exitCode = 1;
      }
    });

  plugin
    .command("enable <name>")
    .option("--project <path>", "Scope this enable to a single registered project instead of globally")
    .description("Enable plugin (globally, or for one project with --project)")
    .action(async (name: string, options: { project?: string }) => {
      const startedAt = Date.now();
      try {
        if (options.project) {
          const { setPluginProjectOverride } = await import("../core/plugin-manager.js");
          const resolvedPath = path.resolve(options.project);
          await setPluginProjectOverride(name, resolvedPath, { enabled: true });
          process.stdout.write(`Plugin ${name} enabled for project: ${resolvedPath}\n`);
        } else {
          const { enablePlugin } = await import("../core/plugin-manager.js");
          await enablePlugin(name);
          process.stdout.write(`Plugin ${name} enabled\n`);
        }
        captureTelemetryEvent({
          name: "operation_completed",
          properties: { operation: "plugin_toggle", outcome: "success", durationBucket: durationBucket(Date.now() - startedAt) }
        });
      } catch (e: any) {
        process.stderr.write(`Error: ${e.message}\n`);
        recordTelemetryOperationFailure("plugin_toggle", e, startedAt);
        process.exitCode = 1;
      }
    });

  plugin
    .command("disable <name>")
    .option("--project <path>", "Scope this disable to a single registered project instead of globally")
    .description("Disable plugin (globally, or for one project with --project)")
    .action(async (name: string, options: { project?: string }) => {
      const startedAt = Date.now();
      try {
        if (options.project) {
          const { setPluginProjectOverride } = await import("../core/plugin-manager.js");
          const resolvedPath = path.resolve(options.project);
          await setPluginProjectOverride(name, resolvedPath, { enabled: false });
          process.stdout.write(`Plugin ${name} disabled for project: ${resolvedPath}\n`);
        } else {
          const { disablePlugin } = await import("../core/plugin-manager.js");
          await disablePlugin(name);
          process.stdout.write(`Plugin ${name} disabled\n`);
        }
        captureTelemetryEvent({
          name: "operation_completed",
          properties: { operation: "plugin_toggle", outcome: "success", durationBucket: durationBucket(Date.now() - startedAt) }
        });
      } catch (e: any) {
        process.stderr.write(`Error: ${e.message}\n`);
        recordTelemetryOperationFailure("plugin_toggle", e, startedAt);
        process.exitCode = 1;
      }
    });

  plugin
    .command("status [name]")
    .description("Show plugin status")
    .action(async (name?: string) => {
      const { getPluginStatus, listPlugins } = await import("../core/plugin-manager.js");
      try {
        if (name) {
          const p = await getPluginStatus(name);
          if (!p) {
            process.stderr.write(`Error: Plugin ${name} not found\n`);
            process.exit(1);
          }
          process.stdout.write(JSON.stringify(p, null, 2) + "\n");
        } else {
          const plugins = await listPlugins();
          process.stdout.write(JSON.stringify(plugins, null, 2) + "\n");
        }
      } catch (e: any) {
        process.stderr.write(`Error: ${e.message}\n`);
        process.exit(1);
      }
    });
}
