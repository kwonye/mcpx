/**
 * Auth setup offered while adding a server (`mcpx add`): HTTP auth probing,
 * token/OAuth prompts, and migrating plain-text stdio env vars to secrets.
 */
import { createInterface } from "node:readline/promises";
import type { SecretsManager } from "../core/secrets.js";
import { probeHttpAuthRequirement } from "../core/auth-probe.js";
import type { HttpServerSpec, UpstreamServerSpec } from "../types.js";
import {
  applyAuthReference,
  defaultAuthSecretName,
  listAuthBindings,
  maybePrefixBearer,
  resolveAuthTarget,
  secretRefName,
  toSecretRef
} from "../core/server-auth.js";
import { runOAuthLogin } from "../core/oauth.js";
import { openInBrowser, promptLine, promptLineWithDefault } from "./shared.js";

function isNegativeChoice(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "n" || normalized === "no";
}

/**
 * Configures auth for a server that's about to be added. The server spec
 * hasn't been persisted to config yet at this point (so `mcpx auth login`'s
 * runOAuthLogin, which requires the server to already exist so it can bind
 * `oauth://<name>` into it, can't run here) -- when the user picks browser
 * sign-in, this only records that choice; the caller runs the actual login
 * after the server has been saved.
 */
export async function maybeAutoConfigureAuthForAddedServer(
  serverName: string,
  spec: UpstreamServerSpec,
  secrets: SecretsManager
): Promise<{ deferredOAuthLogin: boolean }> {
  if (spec.transport === "http") {
    return maybeConfigureHttpAuth(serverName, spec as HttpServerSpec, secrets);
  }
  await maybeConfigureStdioAuth(serverName, spec, secrets);
  return { deferredOAuthLogin: false };
}

async function maybeConfigureHttpAuth(
  serverName: string,
  spec: HttpServerSpec,
  secrets: SecretsManager
): Promise<{ deferredOAuthLogin: boolean }> {
  const probe = await probeHttpAuthRequirement(spec, secrets);
  if (!probe.authRequired) {
    return { deferredOAuthLogin: false };
  }

  process.stdout.write(`Upstream "${serverName}" responded with ${probe.status ?? 401} and appears to require auth.\n`);
  if (probe.wwwAuthenticate) {
    process.stdout.write(`WWW-Authenticate: ${probe.wwwAuthenticate}\n`);
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write(`Run \`mcpx auth set ${serverName} --header Authorization --value \"<token>\"\` to configure auth.\n`);
    if (probe.oauthSupport === "supported") {
      process.stdout.write(`This server supports OAuth -- run \`mcpx auth login ${serverName}\` to sign in with your browser instead.\n`);
    }
    return { deferredOAuthLogin: false };
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    if (probe.oauthSupport === "supported") {
      process.stdout.write(`This server supports OAuth.\n`);
      const useOAuth = await promptLine(rl, "Sign in with browser? (Y/n): ");
      if (!isNegativeChoice(useOAuth)) {
        process.stdout.write(`Will sign in with your browser once "${serverName}" is added.\n`);
        return { deferredOAuthLogin: true };
      }
    } else {
      const shouldConfigure = await promptLine(rl, "Configure auth now? (Y/n): ");
      if (isNegativeChoice(shouldConfigure)) {
        process.stdout.write("Skipping auth setup.\n");
        return { deferredOAuthLogin: false };
      }
    }

    const currentHeaderBinding = listAuthBindings(spec)
      .find((binding) => binding.kind === "header");
    const headerName = await promptLineWithDefault(rl, "Header name", currentHeaderBinding?.key ?? "Authorization");
    if (!headerName) {
      process.stdout.write("Skipping auth setup (empty header name).\n");
      return { deferredOAuthLogin: false };
    }

    const authValueInput = await promptLine(rl, "Auth value/token (blank to skip): ");
    if (!authValueInput) {
      process.stdout.write("Skipping auth setup.\n");
      return { deferredOAuthLogin: false };
    }

    const target = resolveAuthTarget(spec, headerName, undefined);
    const authValue = maybePrefixBearer(target, authValueInput, false);
    const existingValue = listAuthBindings(spec)
      .find((binding) => binding.kind === target.kind && binding.key === target.key)?.value;
    const defaultSecret = secretRefName(existingValue ?? "") ?? defaultAuthSecretName(serverName, target);
    const secretName = await promptLineWithDefault(rl, "Secret name", defaultSecret);

    if (!secretName) {
      process.stdout.write("Skipping auth setup (empty secret name).\n");
      return { deferredOAuthLogin: false };
    }

    secrets.setSecret(secretName, authValue);
    applyAuthReference(spec, target, toSecretRef(secretName));
    process.stdout.write(`Configured auth via ${target.kind}:${target.key} using secret://${secretName}.\n`);
  } catch (error) {
    process.stdout.write(`Auto auth setup skipped: ${(error as Error).message}\n`);
    return { deferredOAuthLogin: false };
  } finally {
    rl.close();
  }

  const verify = await probeHttpAuthRequirement(spec, secrets);
  if (verify.authRequired) {
    process.stdout.write("Auth is configured, but upstream still reports auth required. Re-auth may be needed.\n");
  } else if (verify.error) {
    process.stdout.write(`Auth check after setup could not be completed: ${verify.error}\n`);
  } else {
    process.stdout.write("Auth check passed.\n");
  }
  return { deferredOAuthLogin: false };
}

/** Runs the OAuth login the user opted into during add, now that the server exists in config. */
export async function runDeferredOAuthLogin(
  serverName: string,
  spec: HttpServerSpec,
  secrets: SecretsManager,
  configPath: string
): Promise<void> {
  try {
    await runOAuthLogin(serverName, spec, secrets, (url) => {
      process.stdout.write(`Opening browser to sign in to "${serverName}"...\n`);
      openInBrowser(url);
    }, configPath);
    process.stdout.write(`OAuth login complete for "${serverName}".\n`);
  } catch (error) {
    process.stdout.write(`OAuth sign-in failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.stdout.write(`Run \`mcpx auth login ${serverName}\` to try again.\n`);
  }
}

async function maybeConfigureStdioAuth(
  serverName: string,
  spec: UpstreamServerSpec,
  secrets: SecretsManager
): Promise<void> {
  const binds = listAuthBindings(spec);
  const plainEnvVars = binds.filter((b) => b.kind === "env" && !secretRefName(b.value));

  if (plainEnvVars.length === 0) {
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write(`Server "${serverName}" has plain-text env vars. Run \`mcpx auth set ${serverName} --env KEY=VALUE --value "<token>"\` to store them securely.\n`);
    return;
  }

  process.stdout.write(`Server "${serverName}" has ${plainEnvVars.length} env var(s) stored in plain text.\n`);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const shouldMigrate = await promptLine(rl, "Store them in the encrypted secret store instead? (Y/n): ");
    if (isNegativeChoice(shouldMigrate)) {
      process.stdout.write("Skipping secret migration.\n");
      return;
    }

    for (const binding of plainEnvVars) {
      const target = { kind: "env" as const, key: binding.key };
      const secretName = defaultAuthSecretName(serverName, target);
      secrets.setSecret(secretName, binding.value);
      applyAuthReference(spec, target, toSecretRef(secretName));
      process.stdout.write(`Stored ${binding.key} as secret://${secretName}\n`);
    }
  } catch (error) {
    process.stdout.write(`Secret migration skipped: ${(error as Error).message}\n`);
  } finally {
    rl.close();
  }
}
