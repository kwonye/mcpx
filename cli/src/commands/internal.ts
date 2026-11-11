/**
 * Internal commands spawned by mcpx itself (plugin host wrapper, stdio proxy).
 */
import type { Command } from "commander";
import { runStdioProxy } from "../core/proxy.js";
import type { CommandContext } from "./shared.js";

function registerPluginHostCommand(program: Command): void {
  program
    .command("plugin-host <plugin> <server>")
    .description("Run a managed plugin MCP server")
    .action(async (plugin: string, server: string) => {
      const { runPluginHost } = await import("../core/plugin-host.js");
      await runPluginHost(plugin, server);
    });
}

function registerProxyCommand(program: Command): void {
  program
    .command("proxy <name>")
    .description("Run a stdio MCP proxy bridging to the local mcpx HTTP gateway for the given upstream server")
    .action(async (name: string) => {
      await runStdioProxy(name);
    });
}

export function registerInternal(program: Command, _ctx: CommandContext): void {
  registerPluginHostCommand(program);
  registerProxyCommand(program);
}
