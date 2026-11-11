import type { Command } from "commander";
import fs from "node:fs";
import { loadConfig } from "../core/config.js";
import { SecretsManager } from "../core/secrets.js";
import { getAdapters } from "../adapters/index.js";
import { getDaemonStatus } from "../core/daemon.js";
import { getConfigPath, getManagedIndexPath, getSecretsStorePath } from "../core/paths.js";
import type { CommandContext } from "./shared.js";

export function registerDoctor(program: Command, _ctx: CommandContext): void {
  program
    .command("doctor")
    .option("--json", "Output JSON")
    .description("Run local health checks")
    .action((options: { json?: boolean }) => {
      const config = loadConfig();
      const adapters = getAdapters();
      const checks: Array<{ check: string; status: "ok" | "warn" | "fail"; details: string }> = [];

      checks.push({
        check: "config_path",
        status: fs.existsSync(getConfigPath()) ? "ok" : "warn",
        details: getConfigPath()
      });

      checks.push({
        check: "managed_index_path",
        status: fs.existsSync(getManagedIndexPath()) ? "ok" : "warn",
        details: getManagedIndexPath()
      });

      // Check the active secret backend (encrypted file by default, OS keychain when opted in).
      try {
        const secrets = new SecretsManager();
        secrets.listSecretNames();
        checks.push({
          check: "secrets_store",
          status: "ok",
          details: secrets.backend === "keychain" ? "keychain" : `file (${getSecretsStorePath()})`
        });
      } catch (err) {
        checks.push({
          check: "secrets_store",
          status: "warn",
          details: err instanceof Error ? err.message : "secrets store unavailable"
        });
      }

      const daemon = getDaemonStatus(config);
      checks.push({
        check: "daemon",
        status: daemon.running ? "ok" : "warn",
        details: daemon.running ? `pid ${daemon.pid}` : "not running"
      });

      for (const adapter of adapters) {
        const configPath = adapter.detectConfigPath();
        if (!configPath) {
          checks.push({
            check: `client_${adapter.id}`,
            status: "warn",
            details: "no known config path"
          });
          continue;
        }

        checks.push({
          check: `client_${adapter.id}`,
          status: adapter.supportsHttp() ? "ok" : "warn",
          details: `${configPath}${adapter.supportsHttp() ? "" : " (HTTP unsupported)"}`
        });
      }

      if (options.json) {
        process.stdout.write(`${JSON.stringify({ checks }, null, 2)}\n`);
        return;
      }

      for (const item of checks) {
        process.stdout.write(`[${item.status.toUpperCase()}] ${item.check}: ${item.details}\n`);
      }

      if (checks.some((item) => item.status === "fail")) {
        process.exitCode = 1;
      }
    });
}
