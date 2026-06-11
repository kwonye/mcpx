import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { defaultConfig } from "../src/core/config.js";
import { ensureGatewayToken, getGatewayTokenSecretName, rotateGatewayToken } from "../src/core/registry.js";
import { getGatewayTokenPath } from "../src/core/paths.js";
import { SecretsManager } from "../src/core/secrets.js";
import { setupTempEnv } from "./helpers.js";

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

  it("reads token from existing file", () => {
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
