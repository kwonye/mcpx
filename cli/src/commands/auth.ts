import type { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { loadConfig } from "../core/config.js";
import { mutateConfig } from "../core/config-store.js";
import { rotateGatewayToken } from "../core/registry.js";
import { SecretsManager, readSecretValueFromStdin } from "../core/secrets.js";
import {
  applyAuthReference,
  defaultAuthSecretName,
  listAuthBindings,
  maybePrefixBearer,
  removeAuthReference,
  resolveAuthTarget,
  secretRefName,
  toSecretRef
} from "../core/server-auth.js";
import { restartDaemon } from "../core/daemon.js";
import { captureTelemetryEvent, durationBucket } from "../core/telemetry.js";
import {
  runOAuthLogin,
  isOAuthReference,
  oauthReferenceServerName,
  clearOAuthCredentials,
  getOAuthCredentialStatus
} from "../core/oauth.js";
import { getServerSpecOrThrow, openInBrowser, performOAuthLogout, promptLine, type CommandContext } from "./shared.js";

interface AuthSetOptions {
  header?: string;
  env?: string;
  value?: string;
  secretName?: string;
  raw?: boolean;
}

interface AuthRemoveOptions {
  header?: string;
  env?: string;
  deleteSecret?: boolean;
}

function redactAuthValue(value: string): string {
  if (value.startsWith("secret://")) {
    return value;
  }
  if (isOAuthReference(value)) {
    return value;
  }

  return "<inline>";
}

export function registerAuth(program: Command, _ctx: CommandContext): void {
  const auth = program.command("auth").description("Auth utilities");

  auth
    .command("login <server>")
    .description("Run browser OAuth login for an HTTP upstream server")
    .action(async (server: string) => {
      const startedAt = Date.now();
      const config = loadConfig();
      const spec = getServerSpecOrThrow(config, server);
      if (spec.transport !== "http") {
        throw new Error(`OAuth login only supports HTTP servers.`);
      }

      const secrets = new SecretsManager();
      await runOAuthLogin(server, spec, secrets, (url) => {
        process.stdout.write(`Opening browser to sign in to "${server}"...\n`);
        openInBrowser(url);
      });
      process.stdout.write(`OAuth login complete for "${server}".\n`);
      captureTelemetryEvent({
        name: "operation_completed",
        properties: { operation: "auth_login", outcome: "success", durationBucket: durationBucket(Date.now() - startedAt) }
      });
    });

  auth
    .command("logout <server>")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output JSON")
    .description("Sign out of OAuth for a server and clear stored credentials")
    .action(async (server: string, options: { yes?: boolean; json?: boolean }) => {
      const startedAt = Date.now();
      const config = loadConfig();
      const spec = getServerSpecOrThrow(config, server);

      if (!options.yes) {
        if (!process.stdin.isTTY || !process.stdout.isTTY) {
          throw new Error("Sign-out requires --yes in non-interactive mode.");
        }
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        try {
          const answer = await promptLine(rl, `Sign out of "${server}"? (y/N): `);
          if (!["y", "yes"].includes(answer.trim().toLowerCase())) {
            return;
          }
        } finally {
          rl.close();
        }
      }

      const secrets = new SecretsManager();
      const { removedSecrets, removedBinding, sync } = await performOAuthLogout(server, spec, secrets);

      if (options.json) {
        process.stdout.write(`${JSON.stringify({ server, removedSecrets, removedBinding, sync }, null, 2)}\n`);
        return;
      }

      if (removedSecrets.length === 0 && !removedBinding) {
        process.stdout.write(`"${server}" was not signed in with OAuth. Nothing to do.\n`);
        return;
      }

      const bindingNote = removedBinding ? ` and the ${removedBinding} binding` : "";
      process.stdout.write(
        `Signed out of "${server}". Removed ${removedSecrets.length} stored credential${removedSecrets.length === 1 ? "" : "s"}${bindingNote}.\n`
      );
      process.stdout.write(`Re-run \`mcpx auth login ${server}\` to sign back in.\n`);
      captureTelemetryEvent({
        name: "operation_completed",
        properties: { operation: "auth_logout", outcome: "success", durationBucket: durationBucket(Date.now() - startedAt) }
      });
    });

  auth
    .command("set <server>")
    .option("--header <name>", "HTTP header name (default for HTTP servers: Authorization)")
    .option("--env <name>", "Env var name (required for stdio servers)")
    .option("--value <value>", "Auth value/token (if omitted, read from stdin)")
    .option("--secret-name <name>", "Override stored secret name")
    .option("--raw", "Do not auto-prefix Authorization values with Bearer")
    .description("Store auth as an encrypted secret and bind it to an upstream server")
    .action(async (server: string, options: AuthSetOptions) => {
      const config = loadConfig();
      const spec = getServerSpecOrThrow(config, server);
      const target = resolveAuthTarget(spec, options.header, options.env);
      const provided = options.value ?? readSecretValueFromStdin();
      const authValue = maybePrefixBearer(target, provided, options.raw ?? false);
      const secretName = options.secretName?.trim() || defaultAuthSecretName(server, target);

      const secrets = new SecretsManager();
      secrets.setSecret(secretName, authValue);
      await mutateConfig((freshConfig) => {
        const freshSpec = getServerSpecOrThrow(freshConfig, server);
        applyAuthReference(freshSpec, target, toSecretRef(secretName));
      });

      process.stdout.write(`Configured auth for server "${server}" via ${target.kind} "${target.key}".\n`);
      process.stdout.write(`Stored secret: ${secretName}\n`);
    });

  auth
    .command("rm <server>")
    .option("--header <name>", "HTTP header name (default for HTTP servers: Authorization)")
    .option("--env <name>", "Env var name (required for stdio servers)")
    .option("--delete-secret", "Delete the referenced stored secret when removing binding")
    .description("Remove auth binding from an upstream server")
    .action(async (server: string, options: AuthRemoveOptions) => {
      const config = loadConfig();
      const spec = getServerSpecOrThrow(config, server);
      const target = resolveAuthTarget(spec, options.header, options.env);

      const removedValue = await mutateConfig((freshConfig) => {
        const freshSpec = getServerSpecOrThrow(freshConfig, server);
        return removeAuthReference(freshSpec, target);
      });

      if (!removedValue) {
        process.stdout.write(`No auth binding found for server "${server}" at ${target.kind} "${target.key}".\n`);
        return;
      }

      if (options.deleteSecret) {
        const secretName = secretRefName(removedValue);
        if (secretName) {
          new SecretsManager().removeSecret(secretName);
          process.stdout.write(`Removed binding and deleted secret: ${secretName}\n`);
        } else if (isOAuthReference(removedValue)) {
          const removed = clearOAuthCredentials(oauthReferenceServerName(removedValue), new SecretsManager());
          process.stdout.write(`Removed binding and deleted ${removed.length} OAuth credential${removed.length === 1 ? "" : "s"}.\n`);
          process.stdout.write(`(Equivalent to \`mcpx auth logout ${server}\`.)\n`);
        } else {
          process.stdout.write("Removed binding. Value was inline (no stored secret deleted).\n");
        }
      } else {
        process.stdout.write("Removed binding.\n");
      }
    });

  auth
    .command("show [server]")
    .option("--json", "Output JSON")
    .description("Show configured upstream auth bindings (secret refs only, values redacted)")
    .action((server: string | undefined, options: { json?: boolean }) => {
      const config = loadConfig();
      const names = server ? [server] : Object.keys(config.servers);
      const output = names.map((name) => {
        const spec = getServerSpecOrThrow(config, name);
        const bindings = listAuthBindings(spec).map((binding) => ({
          kind: binding.kind,
          key: binding.key,
          value: redactAuthValue(binding.value)
        }));

        return {
          server: name,
          transport: spec.transport,
          bindings
        };
      });

      if (options.json) {
        process.stdout.write(`${JSON.stringify({ auth: output }, null, 2)}\n`);
        return;
      }

      if (output.length === 0) {
        process.stdout.write("No upstream servers configured.\n");
        return;
      }

      for (const serverEntry of output) {
        process.stdout.write(`- ${serverEntry.server} (${serverEntry.transport})\n`);
        if (serverEntry.bindings.length === 0) {
          process.stdout.write("  (no auth bindings)\n");
          continue;
        }

        for (const binding of serverEntry.bindings) {
          process.stdout.write(`  ${binding.kind}:${binding.key} = ${binding.value}\n`);
        }
      }
    });

  auth
    .command("status [server]")
    .option("--json", "Output JSON")
    .description("Show OAuth sign-in and token/secret auth status (offline, no network calls)")
    .action((server: string | undefined, options: { json?: boolean }) => {
      const config = loadConfig();
      const names = server ? [server] : Object.keys(config.servers);
      const secrets = new SecretsManager();

      const entries = names.map((name) => {
        const spec = getServerSpecOrThrow(config, name);
        const oauth = getOAuthCredentialStatus(name, spec, secrets);
        const bindings = listAuthBindings(spec).map((binding) => {
          if (isOAuthReference(binding.value)) {
            return { kind: binding.kind, key: binding.key, source: "oauth" as const, secretName: null as string | null, secretPresent: null as boolean | null };
          }
          const secretName = secretRefName(binding.value);
          if (secretName) {
            return { kind: binding.kind, key: binding.key, source: "secret" as const, secretName, secretPresent: secrets.getSecret(secretName) !== null };
          }
          return { kind: binding.kind, key: binding.key, source: "inline" as const, secretName: null as string | null, secretPresent: null as boolean | null };
        });

        return { server: name, transport: spec.transport, oauth, bindings };
      });

      if (options.json) {
        process.stdout.write(`${JSON.stringify({ servers: entries }, null, 2)}\n`);
        return;
      }

      if (entries.length === 0) {
        process.stdout.write("No upstream servers configured.\n");
        return;
      }

      const oauthEntries = entries.filter((e) => e.oauth.bound || e.oauth.signedIn);
      const secretRows = entries.flatMap((e) => e.bindings.filter((b) => b.source !== "oauth").map((b) => ({ entry: e, binding: b })));

      if (oauthEntries.length > 0) {
        process.stdout.write("OAuth sign-ins\n");
        for (const entry of oauthEntries) {
          process.stdout.write(`- ${entry.server} (${entry.transport})\n`);
          if (!entry.oauth.signedIn) {
            process.stdout.write(`    status     bound but not signed in — run \`mcpx auth login ${entry.server}\`\n`);
            continue;
          }
          process.stdout.write(`    status     ${entry.oauth.expired ? "expired" : "signed in"}\n`);
          if (entry.oauth.expiresAt) {
            process.stdout.write(`    expires    ${new Date(entry.oauth.expiresAt).toLocaleString()}\n`);
          }
          process.stdout.write(
            `    refresh    ${entry.oauth.hasRefreshToken ? "available" : `none — run \`mcpx auth login ${entry.server}\` to re-authenticate`}\n`
          );
          process.stdout.write(`    client     ${entry.oauth.clientRegistered ? "registered" : "not registered"}\n`);
        }
        process.stdout.write("\n");
      }

      if (secretRows.length > 0) {
        process.stdout.write("Token / secret auth\n");
        for (const { entry, binding } of secretRows) {
          const label =
            binding.source === "secret"
              ? `secret://${binding.secretName}${binding.secretPresent ? "" : "  MISSING"}`
              : "<inline>";
          process.stdout.write(`- ${entry.server} (${entry.transport})  ${binding.kind}:${binding.key}  ${label}\n`);
        }
        process.stdout.write("\n");
      }

      if (oauthEntries.length === 0 && secretRows.length === 0) {
        process.stdout.write("No auth configured for any server.\n");
      }
    });

  auth
    .command("rotate-local-token")
    .description("Rotate bearer token used for local client->mcpx auth")
    .action(async () => {
      const config = loadConfig();
      const secrets = new SecretsManager();
      rotateGatewayToken(config, secrets);
      await restartDaemon(config, process.argv[1] ?? "", secrets);
      process.stdout.write("Rotated local gateway token and restarted daemon.\n");
      process.stdout.write("No client configs were modified.\n");
      process.stdout.write("Run `mcpx sync <client>` (or `mcpx sync`) to update managed `mcpx` entries with the new token.\n");
    });
}
