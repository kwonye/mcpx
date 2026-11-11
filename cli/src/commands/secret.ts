import type { Command } from "commander";
import { SecretsManager, readSecretValueFromStdin } from "../core/secrets.js";
import type { CommandContext } from "./shared.js";

export function registerSecret(program: Command, _ctx: CommandContext): void {
  const secret = program.command("secret").description("Manage encrypted secrets");

  secret
    .command("set <name>")
    .option("--value <value>", "Secret value")
    .description("Set an encrypted secret")
    .action((name: string, options: { value?: string }) => {
      const value = options.value ?? readSecretValueFromStdin();
      new SecretsManager().setSecret(name, value);
      process.stdout.write(`Secret set: ${name}\n`);
    });

  secret
    .command("rm <name>")
    .description("Remove an encrypted secret")
    .action((name: string) => {
      new SecretsManager().removeSecret(name);
      process.stdout.write(`Secret removed: ${name}\n`);
    });

  secret
    .command("ls")
    .description("List secret names tracked by mcpx")
    .action(() => {
      const names = new SecretsManager().listSecretNames();
      if (names.length === 0) {
        process.stdout.write("No tracked secrets.\n");
        return;
      }

      for (const name of names) {
        process.stdout.write(`${name}\n`);
      }
    });
}
