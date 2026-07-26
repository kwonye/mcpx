import { afterEach, describe, expect, it } from "bun:test";
import { defaultConfig, loadConfig, saveConfig } from "../src/core/config.js";
import { SecretsManager } from "../src/core/secrets.js";
import { oauthSecretNames } from "../src/core/oauth.js";
import { runCli } from "../src/cli.js";
import { setupTempEnv } from "./helpers.js";

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  let output = "";
  const original = process.stdout.write;
  process.stdout.write = ((chunk: unknown) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = original;
  }
  return output;
}

function seedOAuthServer(serverName: string, options: { withRefreshToken?: boolean; withClient?: boolean } = {}): void {
  const config = defaultConfig();
  config.servers[serverName] = {
    transport: "http",
    url: `https://${serverName}.example.com/mcp`,
    headers: { Authorization: `oauth://${serverName}` }
  };
  saveConfig(config);

  const secrets = new SecretsManager();
  const names = oauthSecretNames(serverName);
  secrets.setSecret(
    names.tokens,
    JSON.stringify({
      tokens: {
        access_token: "access-token-value",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: options.withRefreshToken === false ? undefined : "refresh-token-value"
      },
      obtainedAt: Date.now()
    })
  );
  if (options.withClient !== false) {
    secrets.setSecret(names.client, JSON.stringify({ client_id: "client-1" }));
  }
}

describe("mcpx auth logout", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  it("reports nothing to do for a server that was never signed in with OAuth", async () => {
    const env = setupTempEnv("mcpx-auth-logout-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers["plain-server"] = { transport: "http", url: "https://plain.example.com/mcp" };
    saveConfig(config);

    const output = await captureStdout(() => runCli(["node", "mcpx", "auth", "logout", "plain-server", "--yes"]));

    expect(output).toContain("was not signed in with OAuth");
  });

  it("clears all stored credentials and the Authorization binding, then re-syncs", async () => {
    const env = setupTempEnv("mcpx-auth-logout-");
    cleanups.push(env.restore);
    seedOAuthServer("notion");

    const output = await captureStdout(() => runCli(["node", "mcpx", "auth", "logout", "notion", "--yes"]));

    expect(output).toContain('Signed out of "notion"');
    expect(output).toContain("Authorization binding");
    expect(output).toContain("mcpx auth login notion");

    const names = oauthSecretNames("notion");
    const secrets = new SecretsManager();
    expect(secrets.getSecret(names.tokens)).toBeNull();
    expect(secrets.getSecret(names.client)).toBeNull();
    expect(secrets.getSecret(names.verifier)).toBeNull();
    expect(secrets.getSecret(names.discovery)).toBeNull();

    const finalSpec = loadConfig().servers.notion;
    expect(finalSpec?.transport).toBe("http");
    expect((finalSpec as { headers?: Record<string, string> }).headers?.Authorization).toBeUndefined();
  });

  it("supports --json output with the removed secret names and binding", async () => {
    const env = setupTempEnv("mcpx-auth-logout-");
    cleanups.push(env.restore);
    seedOAuthServer("notion");

    const output = await captureStdout(() => runCli(["node", "mcpx", "auth", "logout", "notion", "--yes", "--json"]));
    const parsed = JSON.parse(output);

    expect(parsed.server).toBe("notion");
    expect(parsed.removedBinding).toBe("Authorization");
    expect(parsed.removedSecrets.length).toBeGreaterThan(0);
    expect(parsed.removedSecrets).toContain(oauthSecretNames("notion").tokens);
  });

  it("requires --yes in non-interactive mode", async () => {
    const env = setupTempEnv("mcpx-auth-logout-");
    cleanups.push(env.restore);
    seedOAuthServer("notion");

    await expect(runCli(["node", "mcpx", "auth", "logout", "notion"])).rejects.toThrow(/--yes/);

    // Nothing was touched.
    const secrets = new SecretsManager();
    expect(secrets.getSecret(oauthSecretNames("notion").tokens)).not.toBeNull();
  });
});

describe("mcpx auth status", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  it("reports no servers configured", async () => {
    const env = setupTempEnv("mcpx-auth-status-");
    cleanups.push(env.restore);

    const output = await captureStdout(() => runCli(["node", "mcpx", "auth", "status"]));
    expect(output).toContain("No upstream servers configured.");
  });

  it("shows a signed-in OAuth server with expiry, refresh, and client-registration status", async () => {
    const env = setupTempEnv("mcpx-auth-status-");
    cleanups.push(env.restore);
    seedOAuthServer("notion");

    const output = await captureStdout(() => runCli(["node", "mcpx", "auth", "status"]));

    expect(output).toContain("OAuth sign-ins");
    expect(output).toContain("notion (http)");
    expect(output).toContain("signed in");
    expect(output).toContain("available"); // refresh token present
    expect(output).toContain("registered"); // client registered
  });

  it("flags an OAuth server with no refresh token", async () => {
    const env = setupTempEnv("mcpx-auth-status-");
    cleanups.push(env.restore);
    seedOAuthServer("notion", { withRefreshToken: false });

    const output = await captureStdout(() => runCli(["node", "mcpx", "auth", "status"]));

    expect(output).toContain("none — run `mcpx auth login notion`");
  });

  it("lists a plain secret-backed binding with its secret name", async () => {
    const env = setupTempEnv("mcpx-auth-status-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers["linear"] = {
      transport: "http",
      url: "https://linear.example.com/mcp",
      headers: { Authorization: "secret://auth_linear_header_authorization" }
    };
    saveConfig(config);
    new SecretsManager().setSecret("auth_linear_header_authorization", "Bearer some-token");

    const output = await captureStdout(() => runCli(["node", "mcpx", "auth", "status"]));

    expect(output).toContain("Token / secret auth");
    expect(output).toContain("secret://auth_linear_header_authorization");
    expect(output).not.toContain("MISSING");
  });

  it("flags a missing secret referenced by a binding", async () => {
    const env = setupTempEnv("mcpx-auth-status-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers["gh"] = { transport: "stdio", command: "gh-mcp", env: { GITHUB_TOKEN: "secret://auth_gh_env_github_token" } };
    saveConfig(config);
    // Deliberately not stored -- the binding references a secret that doesn't exist.

    const output = await captureStdout(() => runCli(["node", "mcpx", "auth", "status"]));

    expect(output).toContain("secret://auth_gh_env_github_token  MISSING");
  });

  it("redacts values in --json output the same way as the text form", async () => {
    const env = setupTempEnv("mcpx-auth-status-");
    cleanups.push(env.restore);
    seedOAuthServer("notion");

    const output = await captureStdout(() => runCli(["node", "mcpx", "auth", "status", "--json"]));
    const parsed = JSON.parse(output);

    expect(parsed.servers).toHaveLength(1);
    expect(parsed.servers[0].server).toBe("notion");
    expect(parsed.servers[0].oauth.signedIn).toBe(true);
    expect(parsed.servers[0].oauth.hasRefreshToken).toBe(true);
    expect(parsed.servers[0].oauth.expired).toBe(false);
    // No raw token values anywhere in the JSON payload.
    expect(output).not.toContain("access-token-value");
  });

  it("filters to a single server when given a name", async () => {
    const env = setupTempEnv("mcpx-auth-status-");
    cleanups.push(env.restore);
    seedOAuthServer("notion");
    const config = loadConfig();
    config.servers["other"] = { transport: "http", url: "https://other.example.com/mcp" };
    saveConfig(config);

    const output = await captureStdout(() => runCli(["node", "mcpx", "auth", "status", "notion"]));

    expect(output).toContain("notion");
    expect(output).not.toContain("other (http)");
  });
});

describe("mcpx auth rm --delete-secret on an OAuth binding", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  it("clears OAuth credentials instead of reporting the binding as inline", async () => {
    // Regression test: secretRefName() returns null for oauth:// refs, so
    // this used to fall into the "Value was inline" branch and orphan all
    // four OAuth secrets instead of deleting them.
    const env = setupTempEnv("mcpx-auth-rm-");
    cleanups.push(env.restore);
    seedOAuthServer("notion");

    const output = await captureStdout(() =>
      runCli(["node", "mcpx", "auth", "rm", "notion", "--header", "Authorization", "--delete-secret"])
    );

    expect(output).not.toContain("Value was inline");
    expect(output).toContain("OAuth credential");

    const names = oauthSecretNames("notion");
    const secrets = new SecretsManager();
    expect(secrets.getSecret(names.tokens)).toBeNull();
    expect(secrets.getSecret(names.client)).toBeNull();
  });
});

describe("mcpx auth show with an OAuth binding", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  it("labels an oauth:// reference distinctly instead of <inline>", async () => {
    const env = setupTempEnv("mcpx-auth-show-");
    cleanups.push(env.restore);
    seedOAuthServer("notion");

    const output = await captureStdout(() => runCli(["node", "mcpx", "auth", "show", "notion"]));

    expect(output).toContain("oauth://notion");
    expect(output).not.toContain("<inline>");
  });
});
