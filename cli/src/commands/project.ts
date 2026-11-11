import type { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../core/config.js";
import { mutateConfig } from "../core/config-store.js";
import { captureTelemetryEvent, durationBucket } from "../core/telemetry.js";
import { autoSyncManagedEntries, type CommandContext } from "./shared.js";
import { recordTelemetryOperationFailure } from "./telemetry-support.js";

export function registerProjects(program: Command, { cliPath }: CommandContext): void {
  const projectCmd = program
    .command("project")
    .description("Manage project-based MCP configurations");

  projectCmd.command("instructions [target]")
    .description("Read applicable AGENTS.md files, from project root to nearest scope")
    .option("--root <directory>", "Project root", process.cwd())
    .action(async (target: string | undefined, options: { root: string }) => {
      const { readAgentInstructions } = await import("../core/agent-instructions.js");
      for (const instruction of readAgentInstructions(options.root, target ?? options.root)) {
        process.stdout.write(`# ${instruction.path}\n\n${instruction.content}\n`);
      }
    });

  projectCmd
    .command("init [name]")
    .description("Initialize a local .mcpx.json configuration in the current directory")
    .action(async (name?: string) => {
      const startedAt = Date.now();
      const targetPath = path.join(process.cwd(), ".mcpx.json");
      if (fs.existsSync(targetPath)) {
        process.stderr.write(`Local project configuration already exists at: ${targetPath}\n`);
        recordTelemetryOperationFailure("project_init", { code: "validation_error" }, startedAt);
        process.exitCode = 1;
        return;
      }

      const projectName = name?.trim() || path.basename(process.cwd());
      const localConfig = {
        name: projectName,
        servers: {}
      };

      const { saveProjectConfig } = await import("../core/config.js");
      saveProjectConfig(localConfig, targetPath);
      process.stdout.write(`Initialized project configuration at: ${targetPath}\n`);

      const { registerProject } = await import("../core/registry.js");
      await mutateConfig((globalConfig) => {
        registerProject(globalConfig, process.cwd(), projectName);
      });
      process.stdout.write(`Registered project "${projectName}" globally.\n`);
      captureTelemetryEvent({
        name: "operation_completed",
        properties: { operation: "project_init", outcome: "success", durationBucket: durationBucket(Date.now() - startedAt) }
      });
    });

  projectCmd
    .command("list")
    .description("List all globally registered project paths")
    .action(() => {
      const globalConfig = loadConfig();
      const projects = Object.entries(globalConfig.projects ?? {});

      if (projects.length === 0) {
        process.stdout.write("No projects currently registered.\n");
        return;
      }

      process.stdout.write("Registered Projects:\n");
      for (const [projectPath, entry] of projects) {
        process.stdout.write(`- ${entry.name}: ${projectPath}\n`);
      }
    });

  projectCmd
    .command("remove <path>")
    .description("Unregister a project path from the global configuration")
    .action(async (projectPath: string) => {
      const startedAt = Date.now();
      const resolvedPath = path.resolve(projectPath);
      const globalConfig = loadConfig();
      if (!globalConfig.projects || !globalConfig.projects[resolvedPath]) {
        process.stderr.write(`No registered project found at path: ${resolvedPath}\n`);
        recordTelemetryOperationFailure("project_remove", { code: "validation_error" }, startedAt);
        process.exitCode = 1;
        return;
      }

      const entry = globalConfig.projects[resolvedPath];
      const { unregisterProject } = await import("../core/registry.js");
      await mutateConfig((freshConfig) => {
        unregisterProject(freshConfig, resolvedPath);
      });
      process.stdout.write(`Unregistered project "${entry.name}" (${resolvedPath}) from the global configuration.\n`);
      
      process.stdout.write("Syncing managed integrations to detected and selected harnesses...\n");
      await autoSyncManagedEntries(cliPath);
      captureTelemetryEvent({
        name: "operation_completed",
        properties: { operation: "project_remove", outcome: "success", durationBucket: durationBucket(Date.now() - startedAt) }
      });
    });
}
