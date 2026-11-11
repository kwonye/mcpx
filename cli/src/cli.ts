#!/usr/bin/env node
/**
 * mcpx CLI - HTTP-first Model Context Protocol gateway
 */
import { Command } from "commander";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ConfigLoadError } from "./core/config.js";
import { parseCompatibilityArgs } from "./compat/index.js";
import { APP_VERSION } from "./version.js";
import { getStagedCliPath, getStagedUpdate, shouldUseStagedCli } from "./core/update.js";
import { runBackgroundUpdate } from "./core/update-manager.js";
import {
  architecture,
  captureTelemetryEvent,
  durationBucket,
  initializeTelemetry,
  platformFamily,
  flushTelemetry,
  reportTelemetryError,
  type TelemetryRuntime
} from "./core/telemetry.js";
import { flushNodeErrorReporting, initializeNodeErrorReporting } from "./core/error-reporting.js";
import type { CommandContext } from "./commands/shared.js";
import {
  recordTelemetryOperationFailure,
  showCliTelemetryNotice,
  telemetryErrorCode,
  telemetryLaunchMode,
  telemetryOperation
} from "./commands/telemetry-support.js";
import { registerServers, registerMcpCompat } from "./commands/servers.js";
import { registerSync } from "./commands/sync.js";
import { registerStatus } from "./commands/status.js";
import { registerDoctor } from "./commands/doctor.js";
import { registerDaemon } from "./commands/daemon.js";
import { registerService } from "./commands/service.js";
import { registerSecret } from "./commands/secret.js";
import { registerAuth } from "./commands/auth.js";
import { registerClients } from "./commands/clients.js";
import { registerSkill } from "./commands/skill.js";
import { registerShare } from "./commands/share.js";
import { registerInternal } from "./commands/internal.js";
import { registerUpdate } from "./commands/update.js";
import { registerProjects } from "./commands/project.js";
import { registerPlugin } from "./commands/plugin.js";
import { registerTelemetry } from "./commands/telemetry.js";

export async function runCli(argv = process.argv): Promise<void> {
  if (process.env.MCPX_UPDATE_CHILD === "1") {
    await runBackgroundUpdate();
    return;
  }

  const rawArgs = argv.slice(2);
  const startedAt = Date.now();
  const isUpdateCommand = rawArgs[0] === "update";

  const runtime: TelemetryRuntime = rawArgs[0] === "daemon" && rawArgs[1] === "run" ? "daemon" : "cli";
  showCliTelemetryNotice(rawArgs);
  const release = process.env.MCPX_SENTRY_RELEASE || APP_VERSION;
  const telemetryVersion = release.startsWith("mcpx@") ? release.slice("mcpx@".length) : APP_VERSION;
  initializeTelemetry(runtime, {
    release,
    platform: process.platform,
    architecture: process.arch
  });
  initializeNodeErrorReporting(runtime, release);
  captureTelemetryEvent({
    name: "runtime_started",
    properties: {
      runtime,
      version: telemetryVersion,
      osFamily: platformFamily(),
      architecture: architecture(),
      launchMode: telemetryLaunchMode(rawArgs)
    }
  });

  if (!isUpdateCommand) {
    const stagedCliPath = getStagedCliPath();
    const stagedInfo = getStagedUpdate();

    if (stagedCliPath && stagedInfo && stagedCliPath !== argv[1] && shouldUseStagedCli(stagedInfo.version, APP_VERSION)) {
      try {
        execFileSync(process.execPath, [stagedCliPath, ...rawArgs], {
          stdio: "inherit",
          env: {
            ...process.env,
            MCPX_USING_STAGED: "1"
          }
        });
        return;
      } catch (error) {
        process.stderr.write(
          `Warning: staged update v${stagedInfo.version} failed to run (${(error as Error).message}). ` +
          `Falling back to the currently installed version (v${APP_VERSION}). ` +
          `Run "mcpx update rollback" to clear the broken staged update.\n`
        );
      }
    }
  }

  // Check for client-native compatibility patterns before Commander parses
  if (rawArgs.length > 0) {
    const compat = parseCompatibilityArgs(rawArgs);

    // If unsupported client detected, show error and exit
    if (compat.error && compat.client !== null) {
      process.stderr.write(`Error: ${compat.error}\n`);
      recordTelemetryOperationFailure("server_add", { code: "validation_error" }, startedAt);
      process.exitCode = 1;
      return;
    }

    // If valid compatibility command, normalize and inject into add flow
    if (compat.normalizedArgs !== null) {
      // Replace argv with normalized args for the add command
      // mcpx add <normalizedArgs...>
      argv = [argv[0], argv[1], "add", ...compat.normalizedArgs];
    }
  }

  const cliPath = argv[1] ?? "";

  const program = new Command();
  program.name("mcpx").description("HTTP-first MCP gateway and multi-client installer").version(APP_VERSION);

  // Registration order determines the order commands appear in `--help`.
  const ctx: CommandContext = { cliPath };
  registerServers(program, ctx);
  registerSync(program, ctx);
  registerStatus(program, ctx);
  registerDoctor(program, ctx);
  registerDaemon(program, ctx);
  registerService(program, ctx);
  registerSecret(program, ctx);
  registerAuth(program, ctx);
  registerClients(program, ctx);
  registerSkill(program, ctx);
  registerShare(program, ctx);
  registerInternal(program, ctx);
  registerMcpCompat(program, ctx);
  registerUpdate(program, ctx);
  registerProjects(program, ctx);
  registerPlugin(program, ctx);
  registerTelemetry(program, ctx);

  try {
    await program.parseAsync(argv);
  } catch (error) {
    const operation = telemetryOperation(rawArgs);
    if (operation) {
      captureTelemetryEvent({
        name: "operation_completed",
        properties: { operation, outcome: "failure", errorCode: telemetryErrorCode(error), durationBucket: durationBucket(Date.now() - startedAt) }
      });
    }
    reportTelemetryError(error, {
      runtime,
      operation: operation ?? undefined,
      code: telemetryErrorCode(error)
    });
    throw error;
  } finally {
    await flushTelemetry(150);
    await flushNodeErrorReporting(150);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  void runCli().catch((error) => {
    if (error instanceof ConfigLoadError) {
      process.stderr.write(`Config error: ${error.message}\n`);
      if (error.backupPath) {
        process.stderr.write(`Backup saved to: ${error.backupPath}\n`);
      }
      if (error.issues && error.issues.length > 0) {
        for (const issue of error.issues.slice(0, 5)) {
          process.stderr.write(`  - ${issue}\n`);
        }
      }
      process.stderr.write("Fix the config file or restore from backup.\n");
    } else {
      process.stderr.write(`${(error as Error).message}\n`);
    }
    process.exit(1);
  });
}
