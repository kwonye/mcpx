import type { Command } from "commander";
import { SecretsManager, readSecretValueFromStdin, describeSecretBackend, getSecretBackend, switchSecretBackend } from "../core/secrets.js";
import type { SecretBackendKind } from "../types.js";
import type { CommandContext } from "./shared.js";

function printSecretBackendSwitch(result: ReturnType<typeof switchSecretBackend>): void {
  if (!result.changed) {
    process.stdout.write(`Secret backend already ${result.backend}.\n`);
    return;
  }
  process.stdout.write(`Secret backend: ${result.backend}\n`);
  if (result.migrated.length === 0) {
    process.stdout.write("No stored secrets to migrate.\n");
  } else {
    process.stdout.write(`Migrated ${result.migrated.length} secret(s): ${result.migrated.join(", ")}\n`);
  }
  if (result.preserved.length > 0) {
    const where = result.backend === "keychain" ? "keychain" : "file store";
    process.stdout.write(`Kept ${result.preserved.length} secret(s) already in the ${where}: ${result.preserved.join(", ")}\n`);
  }
  if (result.removedFrom && result.migrated.length > 0) {
    process.stdout.write(
      result.removedFrom === "file"
        ? "Removed secrets from the file store.\n"
        : "Removed secrets from the keychain.\n"
    );
  }
}

export function registerSecret(program: Command, _ctx: CommandContext): void {
  const secret = program.command("secret").description("Manage stored secrets");

  secret
    .command("set <name>")
    .option("--value <value>", "Secret value")
    .description("Set a stored secret")
    .action((name: string, options: { value?: string }) => {
      const value = options.value ?? readSecretValueFromStdin();
      new SecretsManager().setSecret(name, value);
      process.stdout.write(`Secret set: ${name}\n`);
    });

  secret
    .command("rm <name>")
    .description("Remove a stored secret")
    .action((name: string) => {
      new SecretsManager().removeSecret(name);
      process.stdout.write(`Secret removed: ${name}\n`);
    });

  secret
    .command("ls")
    .description("List secret names tracked by mcpx and the active backend")
    .action(() => {
      const secrets = new SecretsManager();
      process.stdout.write(`backend: ${secrets.backend}\n`);
      const names = secrets.listSecretNames();
      if (names.length === 0) {
        process.stdout.write("No tracked secrets.\n");
        return;
      }

      for (const name of names) {
        process.stdout.write(`${name}\n`);
      }
    });

  secret
    .command("backend [kind]")
    .description("Show or switch the secret backend (file, or keychain on macOS and Linux)")
    .action((kind?: string) => {
      if (kind === undefined) {
        const backend = getSecretBackend();
        process.stdout.write(`Secret backend: ${backend}\n`);
        process.stdout.write(`${describeSecretBackend(backend)}\n`);
        return;
      }
      if (kind !== "file" && kind !== "keychain") {
        throw new Error(`Unknown secret backend "${kind}". Use "file" or "keychain".`);
      }
      printSecretBackendSwitch(switchSecretBackend(kind as SecretBackendKind));
    });
}
