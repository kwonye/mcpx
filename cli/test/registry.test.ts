import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { defaultConfig } from "../src/core/config.js";
import { ensureGatewayToken, getGatewayTokenSecretName, rotateGatewayToken, setProjectServerEnabled, registerProject } from "../src/core/registry.js";
import { getGatewayTokenPath } from "../src/core/paths.js";
import { SecretsManager } from "../src/core/secrets.js";
import { setupTempEnv } from "./helpers.js";

describe("setProjectServerEnabled", () => {
  it("disables a server for a project by adding to disabledServers", () => {
    const config = defaultConfig();
    config.servers.github = { transport: "http", url: "https://github.com/mcp", enabled: true };
    config.projects = {
      "/my/project": { name: "my-project", path: "/my/project", disabledServers: [] }
    };

    setProjectServerEnabled(config, "/my/project", "github", false);

    expect(config.projects["/my/project"].disabledServers).toContain("github");
    // Global flag unchanged
    expect(config.servers.github.enabled).toBe(true);
  });

  it("enables a server for a project by removing from disabledServers", () => {
    const config = defaultConfig();
    config.servers.github = { transport: "http", url: "https://github.com/mcp", enabled: true };
    config.projects = {
      "/my/project": { name: "my-project", path: "/my/project", disabledServers: ["github"] }
    };

    setProjectServerEnabled(config, "/my/project", "github", true);

    expect(config.projects["/my/project"].disabledServers).not.toContain("github");
  });

  it("does not duplicate entries when disabling an already-disabled server", () => {
    const config = defaultConfig();
    config.servers.github = { transport: "http", url: "https://github.com/mcp", enabled: true };
    config.projects = {
      "/my/project": { name: "my-project", path: "/my/project", disabledServers: ["github"] }
    };

    setProjectServerEnabled(config, "/my/project", "github", false);

    expect(config.projects["/my/project"].disabledServers?.filter((s) => s === "github").length).toBe(1);
  });

  it("enabling a globally-disabled server also flips its global flag ON (vice-versa rule)", () => {
    const config = defaultConfig();
    config.servers.github = { transport: "http", url: "https://github.com/mcp", enabled: false };
    config.projects = {
      "/my/project": { name: "my-project", path: "/my/project", disabledServers: ["github"] }
    };

    setProjectServerEnabled(config, "/my/project", "github", true);

    // Globally enabled now
    expect(config.servers.github.enabled).toBe(true);
    expect(config.projects["/my/project"].disabledServers).not.toContain("github");
  });

  it("resolves path with path.resolve so keys are consistent", () => {
    const config = defaultConfig();
    config.servers.github = { transport: "http", url: "https://github.com/mcp", enabled: true };
    // Register the project with a resolved path
    registerProject(config, "/my/project");

    setProjectServerEnabled(config, "/my/project", "github", false);

    const key = Object.keys(config.projects ?? {}).find((k) => k.includes("project"));
    expect(key).toBeDefined();
    expect(config.projects![key!].disabledServers).toContain("github");
  });

  it("throws when the project path is not registered", () => {
    const config = defaultConfig();
    config.servers.github = { transport: "http", url: "https://github.com/mcp", enabled: true };

    expect(() => setProjectServerEnabled(config, "/not/registered", "github", false)).toThrow();
  });
});

describe("gateway token management", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const fn of cleanups) {
      fn();
    }
    cleanups.length = 0;
  });

  it("returns env override when MCPX_SECRET_<name> is set", () => {
    const env = setupTempEnv("mcpx-registry-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    const secrets = new SecretsManager();
    const token = ensureGatewayToken(config, secrets);

    expect(token).toBe("test-local-token");

    const tokenPath = getGatewayTokenPath(getGatewayTokenSecretName(config));
    expect(fs.existsSync(tokenPath)).toBe(false);
  });

  it("creates token file with 0600 and returns stable value across calls", () => {
    const env = setupTempEnv("mcpx-registry-");
    cleanups.push(env.restore);

    const originalEnv = process.env.MCPX_SECRET_local_gateway_token;
    delete process.env.MCPX_SECRET_local_gateway_token;
    cleanups.push(() => {
      process.env.MCPX_SECRET_local_gateway_token = originalEnv;
    });

    const config = defaultConfig();
    const secrets = new SecretsManager();
    const token = ensureGatewayToken(config, secrets);

    expect(token).toBeTruthy();
    expect(token.length).toBeGreaterThan(0);

    const tokenPath = getGatewayTokenPath(getGatewayTokenSecretName(config));
    expect(fs.existsSync(tokenPath)).toBe(true);

    const stat = fs.statSync(tokenPath);
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);

    const fileContent = fs.readFileSync(tokenPath, "utf8").trim();
    expect(fileContent).toBe(token);

    const token2 = ensureGatewayToken(config, secrets);
    expect(token2).toBe(token);
  });

  it("reads token from existing file without writing to store", () => {
    const env = setupTempEnv("mcpx-registry-");
    cleanups.push(env.restore);

    const originalEnv = process.env.MCPX_SECRET_local_gateway_token;
    delete process.env.MCPX_SECRET_local_gateway_token;
    cleanups.push(() => {
      process.env.MCPX_SECRET_local_gateway_token = originalEnv;
    });

    const config = defaultConfig();
    const secrets = new SecretsManager();
    const tokenPath = getGatewayTokenPath(getGatewayTokenSecretName(config));

    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, "known-test-token\n", { mode: 0o600 });

    const token = ensureGatewayToken(config, secrets);
    expect(token).toBe("known-test-token");

    // Verify no store entry was created for the token
    expect(secrets.getSecret(getGatewayTokenSecretName(config))).toBeNull();
  });

  it("migrates token from encrypted store to file", () => {
    const env = setupTempEnv("mcpx-registry-");
    cleanups.push(env.restore);

    const originalEnv = process.env.MCPX_SECRET_local_gateway_token;
    delete process.env.MCPX_SECRET_local_gateway_token;
    cleanups.push(() => {
      process.env.MCPX_SECRET_local_gateway_token = originalEnv;
    });

    const config = defaultConfig();
    const secrets = new SecretsManager();
    const secretName = getGatewayTokenSecretName(config);

    // Pre-populate the store with a token (no file)
    secrets.setSecret(secretName, "store-token-value");

    const token = ensureGatewayToken(config, secrets);
    expect(token).toBe("store-token-value");

    // File should now exist with the same value
    const tokenPath = getGatewayTokenPath(secretName);
    expect(fs.existsSync(tokenPath)).toBe(true);
    expect(fs.readFileSync(tokenPath, "utf8").trim()).toBe("store-token-value");
  });

  it("rotateGatewayToken removes the store entry", () => {
    const env = setupTempEnv("mcpx-registry-");
    cleanups.push(env.restore);

    const originalEnv = process.env.MCPX_SECRET_local_gateway_token;
    delete process.env.MCPX_SECRET_local_gateway_token;
    cleanups.push(() => {
      process.env.MCPX_SECRET_local_gateway_token = originalEnv;
    });

    const config = defaultConfig();
    const secrets = new SecretsManager();
    const secretName = getGatewayTokenSecretName(config);

    // Pre-populate store to test removal
    secrets.setSecret(secretName, "old-token");

    const newToken = rotateGatewayToken(config, secrets);
    expect(newToken).toBeTruthy();

    // Store entry should be removed
    expect(secrets.getSecret(secretName)).toBeNull();

    // File should have the new token
    const tokenPath = getGatewayTokenPath(secretName);
    expect(fs.readFileSync(tokenPath, "utf8").trim()).toBe(newToken);
  });

  it("rotateGatewayToken changes the file value", () => {
    const env = setupTempEnv("mcpx-registry-");
    cleanups.push(env.restore);

    const originalEnv = process.env.MCPX_SECRET_local_gateway_token;
    delete process.env.MCPX_SECRET_local_gateway_token;
    cleanups.push(() => {
      process.env.MCPX_SECRET_local_gateway_token = originalEnv;
    });

    const config = defaultConfig();
    const secrets = new SecretsManager();
    const token = ensureGatewayToken(config, secrets);

    const newToken = rotateGatewayToken(config, secrets);
    expect(newToken).not.toBe(token);
    expect(newToken).toBeTruthy();
    expect(newToken.length).toBeGreaterThan(0);

    const tokenPath = getGatewayTokenPath(getGatewayTokenSecretName(config));
    const fileContent = fs.readFileSync(tokenPath, "utf8").trim();
    expect(fileContent).toBe(newToken);

    const token3 = ensureGatewayToken(config, secrets);
    expect(token3).toBe(newToken);
  });
});
