import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { SecretsManager } from "../src/core/secrets.js";
import { getSecretsStorePath, getSecretsKeyPath } from "../src/core/paths.js";
import { setupTempEnv } from "./helpers.js";

describe("SecretsManager with encrypted file store", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const fn of cleanups) {
      fn();
    }
    cleanups.length = 0;
  });

  it("round-trips secrets across set, get, list, and remove", () => {
    const env = setupTempEnv("mcpx-secrets-");
    cleanups.push(env.restore);

    const sm = new SecretsManager();
    expect(sm.listSecretNames()).toEqual([]);

    sm.setSecret("my_key", "my_value");
    expect(sm.getSecret("my_key")).toBe("my_value");
    expect(sm.listSecretNames()).toEqual(["my_key"]);

    sm.setSecret("another", "other_val");
    expect(sm.listSecretNames()).toEqual(["another", "my_key"]);

    sm.removeSecret("my_key");
    expect(sm.getSecret("my_key")).toBeNull();
    expect(sm.listSecretNames()).toEqual(["another"]);

    expect(sm.getSecret("nonexistent")).toBeNull();
  });

  it("persists across SecretsManager instances", () => {
    const env = setupTempEnv("mcpx-secrets-");
    cleanups.push(env.restore);

    new SecretsManager().setSecret("persist_key", "persist_val");

    const sm2 = new SecretsManager();
    expect(sm2.getSecret("persist_key")).toBe("persist_val");
    expect(sm2.listSecretNames()).toEqual(["persist_key"]);
  });

  it("creates key file on first write and reuses it across instances", () => {
    const env = setupTempEnv("mcpx-secrets-");
    cleanups.push(env.restore);

    const keyPath = getSecretsKeyPath();
    expect(fs.existsSync(keyPath)).toBe(false);

    new SecretsManager().setSecret("k1", "v1");

    expect(fs.existsSync(keyPath)).toBe(true);
    const keyContent = fs.readFileSync(keyPath, "utf8").trim();
    expect(keyContent.length).toBeGreaterThan(0);

    new SecretsManager().setSecret("k2", "v2");
    const keyContent2 = fs.readFileSync(keyPath, "utf8").trim();
    expect(keyContent2).toBe(keyContent);
  });

  it("sets 0600 permissions on store and key files (POSIX)", () => {
    const env = setupTempEnv("mcpx-secrets-");
    cleanups.push(env.restore);

    if (process.platform === "win32") return;

    new SecretsManager().setSecret("perm_test", "val");

    const storePath = getSecretsStorePath();
    const keyPath = getSecretsKeyPath();

    expect(fs.statSync(storePath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600);
  });

  it("resolves MCPX_SECRET_<name> env override over stored value", () => {
    const env = setupTempEnv("mcpx-secrets-");
    cleanups.push(env.restore);

    const secretName = "test_override";
    const envName = `MCPX_SECRET_${secretName}`;
    process.env[envName] = "from-env";
    cleanups.push(() => {
      delete process.env[envName];
    });

    const sm = new SecretsManager();
    sm.setSecret(secretName, "from-store");

    expect(sm.getSecret(secretName)).toBe("from-env");
  });

  it("returns null/[] for corrupt store without throwing", () => {
    const env = setupTempEnv("mcpx-secrets-");
    cleanups.push(env.restore);

    const storePath = getSecretsStorePath();
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, "this is not valid json or encrypted data\n");

    const sm = new SecretsManager();
    expect(sm.listSecretNames()).toEqual([]);
    expect(sm.getSecret("anything")).toBeNull();
  });

  it("renames corrupt store on set and creates fresh store", () => {
    const env = setupTempEnv("mcpx-secrets-");
    cleanups.push(env.restore);

    const storePath = getSecretsStorePath();
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, "garbage data\n");

    const sm = new SecretsManager();
    sm.setSecret("after_corrupt", "works");

    const dir = path.dirname(storePath);
    const corruptFiles = fs.readdirSync(dir).filter((f) => f.startsWith("secrets.json.corrupt-"));
    expect(corruptFiles.length).toBeGreaterThanOrEqual(1);

    expect(sm.getSecret("after_corrupt")).toBe("works");
  });

  it("returns null for tampered ciphertext (GCM auth failure)", () => {
    const env = setupTempEnv("mcpx-secrets-");
    cleanups.push(env.restore);

    const sm = new SecretsManager();
    sm.setSecret("safe", "data");

    const storePath = getSecretsStorePath();
    const raw = JSON.parse(fs.readFileSync(storePath, "utf8"));
    raw.ciphertext = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    fs.writeFileSync(storePath, JSON.stringify(raw) + "\n");

    expect(sm.getSecret("safe")).toBeNull();
    expect(sm.listSecretNames()).toEqual([]);
  });

  it("regenerates key and store when key file is deleted", () => {
    const env = setupTempEnv("mcpx-secrets-");
    cleanups.push(env.restore);

    const sm = new SecretsManager();
    sm.setSecret("before", "value");

    const keyPath = getSecretsKeyPath();
    const storePath = getSecretsStorePath();
    expect(fs.existsSync(keyPath)).toBe(true);
    expect(fs.existsSync(storePath)).toBe(true);

    fs.unlinkSync(keyPath);

    expect(sm.getSecret("before")).toBeNull();

    sm.setSecret("after_regenerated", "works");
    expect(sm.getSecret("after_regenerated")).toBe("works");
    expect(sm.getSecret("before")).toBeNull();
  });

  it("resolveMaybeSecret passthrough, resolve, and not-found throw", () => {
    const env = setupTempEnv("mcpx-secrets-");
    cleanups.push(env.restore);

    const sm = new SecretsManager();
    sm.setSecret("resolved_name", "resolved_value");

    expect(sm.resolveMaybeSecret("plain value")).toBe("plain value");
    expect(sm.resolveMaybeSecret("secret://")).toBe("secret://");

    expect(sm.resolveMaybeSecret("secret://resolved_name")).toBe("resolved_value");

    expect(() => sm.resolveMaybeSecret("secret://nonexistent")).toThrow("Secret not found: nonexistent");
  });

  it("rotateLocalToken persists a base64url token", () => {
    const env = setupTempEnv("mcpx-secrets-");
    cleanups.push(env.restore);

    const originalEnv = process.env.MCPX_SECRET_local_gateway_token;
    delete process.env.MCPX_SECRET_local_gateway_token;
    cleanups.push(() => {
      process.env.MCPX_SECRET_local_gateway_token = originalEnv;
    });

    const sm = new SecretsManager();
    const token = sm.rotateLocalToken();

    expect(token).toBeTruthy();
    expect(token.length).toBeGreaterThan(0);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);

    expect(sm.getSecret("local_gateway_token")).toBe(token);

    const token2 = sm.rotateLocalToken();
    expect(token2).not.toBe(token);
    expect(sm.getSecret("local_gateway_token")).toBe(token2);
  });
});
