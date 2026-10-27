import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { defaultConfig, loadConfig, saveConfig } from "../src/core/config.js";
import { getConfigPath, getSecretsKeyPath, getSecretsStorePath } from "../src/core/paths.js";
import { getSecretBackend, SecretsManager, switchSecretBackend } from "../src/core/secrets.js";
import {
  KEYCHAIN_ACCOUNT,
  KEYCHAIN_LABEL,
  KEYCHAIN_SERVICE,
  setSecretCommandRunnerForTests,
  setSecretKeychainPlatformForTests,
  type SecretCommandRequest,
  type SecretCommandResult
} from "../src/core/secret-keychain.js";
import { runCli } from "../src/cli.js";
import { setupTempEnv } from "./helpers.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  setSecretCommandRunnerForTests(null);
  setSecretKeychainPlatformForTests(null);
  while (cleanups.length > 0) cleanups.pop()?.();
});

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

function decodePayload(stored: string): { v: number; secrets: Record<string, string> } {
  return JSON.parse(Buffer.from(stored.trim(), "base64").toString("utf8"));
}

function encodePayload(secrets: Record<string, string>): string {
  return Buffer.from(JSON.stringify({ v: 1, secrets }), "utf8").toString("base64");
}

function createFakeOsSecretStore() {
  let stored: string | null = null;
  let failWrites = false;
  let failDeletes = false;
  let tamperReads = false;
  let honestReadsRemaining = 0;
  const calls: SecretCommandRequest[] = [];

  const runner = (request: SecretCommandRequest): SecretCommandResult => {
    calls.push({ command: request.command, args: [...request.args], input: request.input });
    if (request.command === "security") return handleSecurity(request);
    if (request.command === "secret-tool") return handleSecretTool(request);
    return { status: 127, stdout: "", stderr: `${request.command}: not found` };
  };

  function readValue(): string | null {
    if (stored === null) return null;
    if (!tamperReads) return stored;
    if (honestReadsRemaining > 0) {
      honestReadsRemaining -= 1;
      return stored;
    }
    return encodePayload({ tampered: "1" });
  }

  function handleSecurity(request: SecretCommandRequest): SecretCommandResult {
    const action = request.args[0];
    if (action === "add-generic-password") {
      if (failWrites) return { status: 1, stdout: "", stderr: "write failed" };
      const index = request.args.indexOf("-w");
      const password = request.args[index + 1];
      if (!password) return { status: 1, stdout: "", stderr: "missing password" };
      stored = password;
      return { status: 0, stdout: "", stderr: "" };
    }
    if (action === "find-generic-password") {
      const value = readValue();
      if (value === null) {
        return { status: 44, stdout: "", stderr: "The specified item could not be found in the keychain." };
      }
      return { status: 0, stdout: `${value}\n`, stderr: "" };
    }
    if (action === "delete-generic-password") {
      if (failDeletes) return { status: 1, stdout: "", stderr: "delete failed" };
      if (stored === null) {
        return { status: 44, stdout: "", stderr: "The specified item could not be found in the keychain." };
      }
      stored = null;
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: `unexpected security ${action}` };
  }

  function handleSecretTool(request: SecretCommandRequest): SecretCommandResult {
    const action = request.args[0];
    if (action === "store") {
      if (failWrites) return { status: 1, stdout: "", stderr: "write failed" };
      stored = request.input ?? "";
      return { status: 0, stdout: "", stderr: "" };
    }
    if (action === "lookup") {
      const value = readValue();
      if (value === null) return { status: 1, stdout: "", stderr: "secret-tool: item not found\n" };
      return { status: 0, stdout: value, stderr: "" };
    }
    if (action === "clear") {
      if (failDeletes) return { status: 1, stdout: "", stderr: "delete failed" };
      stored = null;
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: `unexpected secret-tool ${action}` };
  }

  return {
    runner,
    calls,
    seed(value: string) {
      stored = value;
    },
    snapshot() {
      return stored;
    },
    setFailWrites(next: boolean) {
      failWrites = next;
    },
    setFailDeletes(next: boolean) {
      failDeletes = next;
    },
    setTamperReads(next: boolean) {
      tamperReads = next;
      honestReadsRemaining = 0;
    },
    tamperAfterHonestReads(count: number) {
      tamperReads = true;
      honestReadsRemaining = count;
    }
  };
}

describe("secret backend selection", () => {
  it("defaults to the file backend when config omits secrets.backend", () => {
    const env = setupTempEnv("mcpx-secret-backend-");
    cleanups.push(env.restore);

    const configPath = getConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, servers: {} }));

    expect(getSecretBackend()).toBe("file");
    expect(loadConfig().secrets?.backend).toBe("file");
    expect(new SecretsManager().backend).toBe("file");
  });

  it("rejects an unknown secrets.backend without rewriting config", () => {
    const env = setupTempEnv("mcpx-secret-backend-");
    cleanups.push(env.restore);

    const configPath = getConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, secrets: { backend: "vault" } }));

    expect(() => getSecretBackend()).toThrow(/Invalid secrets.backend/);
    expect(fs.readdirSync(path.dirname(configPath)).some((name) => name.includes("invalid"))).toBe(false);
    expect(fs.readFileSync(configPath, "utf8")).toContain("vault");
  });

  it("shows the file backend from secret ls, secret backend, and auth status", async () => {
    const env = setupTempEnv("mcpx-secret-backend-");
    cleanups.push(env.restore);
    new SecretsManager().setSecret("alpha", "from-file");

    const listed = await captureStdout(() => runCli(["node", "mcpx", "secret", "ls"]));
    expect(listed).toContain("backend: file");
    expect(listed).toContain("alpha");
    expect(listed).not.toContain("from-file");

    const shown = await captureStdout(() => runCli(["node", "mcpx", "secret", "backend"]));
    expect(shown).toContain("Secret backend: file");
    expect(shown).toContain("secrets.key");

    const already = await captureStdout(() => runCli(["node", "mcpx", "secret", "backend", "file"]));
    expect(already).toContain("Secret backend already file.");

    const status = await captureStdout(() => runCli(["node", "mcpx", "auth", "status"]));
    expect(status).toContain("Secret backend: file");

    const json = JSON.parse(await captureStdout(() => runCli(["node", "mcpx", "auth", "status", "--json"])));
    expect(json.secretBackend).toBe("file");

    await expect(runCli(["node", "mcpx", "secret", "backend", "vault"])).rejects.toThrow(/Unknown secret backend/);
  });
});

describe("keychain secret backend", () => {
  beforeEach(() => {
    setSecretKeychainPlatformForTests("darwin");
    setSecretCommandRunnerForTests(() => {
      throw new Error("test invoked the real keychain command");
    });
  });

  function useFake() {
    const fake = createFakeOsSecretStore();
    setSecretCommandRunnerForTests(fake.runner);
    return fake;
  }

  it("stores, reads, lists, and removes secrets through the mocked security command", () => {
    const env = setupTempEnv("mcpx-secret-keychain-");
    cleanups.push(env.restore);
    const fake = useFake();

    const result = switchSecretBackend("keychain");
    expect(result.changed).toBe(true);
    expect(result.migrated).toEqual([]);

    const secrets = new SecretsManager();
    secrets.setSecret("alpha", "päss\nword");
    secrets.setSecret("beta", "two");
    expect(fs.existsSync(getSecretsStorePath())).toBe(false);
    expect(fs.existsSync(getSecretsKeyPath())).toBe(false);
    expect(secrets.getSecret("alpha")).toBe("päss\nword");
    expect(secrets.listSecretNames()).toEqual(["alpha", "beta"]);

    const add = fake.calls.filter((call) => call.args[0] === "add-generic-password").at(-1);
    expect(add?.command).toBe("security");
    expect(add?.args.slice(0, -1)).toEqual([
      "add-generic-password",
      "-s", KEYCHAIN_SERVICE,
      "-a", KEYCHAIN_ACCOUNT,
      "-l", KEYCHAIN_LABEL,
      "-U",
      "-w"
    ]);
    expect(add?.args).not.toContain("-A");
    expect(decodePayload(add?.args.at(-1) ?? "").secrets).toMatchObject({ alpha: "päss\nword", beta: "two" });

    secrets.removeSecret("alpha");
    expect(secrets.getSecret("alpha")).toBeNull();
    expect(secrets.listSecretNames()).toEqual(["beta"]);
    secrets.removeSecret("beta");
    expect(secrets.listSecretNames()).toEqual([]);
    expect(fake.snapshot()).toBeNull();
  });

  it("migrates file secrets to the keychain and deletes the file store", async () => {
    const env = setupTempEnv("mcpx-secret-keychain-");
    cleanups.push(env.restore);
    const fake = useFake();
    new SecretsManager().setSecret("auth_linear", "Bearer x");
    new SecretsManager().setSecret("other", "y");

    const output = await captureStdout(() => runCli(["node", "mcpx", "secret", "backend", "keychain"]));

    expect(output).toContain("Secret backend: keychain");
    expect(output).toContain("Migrated 2 secret(s): auth_linear, other");
    expect(output).toContain("Removed secrets from the file store.");
    expect(fs.existsSync(getSecretsStorePath())).toBe(false);
    expect(fs.existsSync(getSecretsKeyPath())).toBe(false);
    expect(getSecretBackend()).toBe("keychain");
    expect(new SecretsManager().getSecret("auth_linear")).toBe("Bearer x");
    expect(decodePayload(fake.snapshot() ?? "").secrets).toEqual({ auth_linear: "Bearer x", other: "y" });

    const config = loadConfig();
    config.servers.linear = {
      transport: "http",
      url: "https://linear.example.com/mcp",
      headers: { Authorization: "secret://auth_linear" }
    };
    saveConfig(config);
    expect(getSecretBackend()).toBe("keychain");

    const status = await captureStdout(() => runCli(["node", "mcpx", "auth", "status"]));
    expect(status).toContain("Secret backend: keychain");
    expect(status).toContain("secret://auth_linear");
    expect(status).not.toContain("MISSING");
    expect(status).not.toContain("Bearer x");

    const listed = await captureStdout(() => runCli(["node", "mcpx", "secret", "ls"]));
    expect(listed).toContain("backend: keychain");
    expect(listed).toContain("auth_linear");
    expect(listed).not.toContain("Bearer x");

    const json = JSON.parse(await captureStdout(() => runCli(["node", "mcpx", "auth", "status", "--json"])));
    expect(json.secretBackend).toBe("keychain");
    expect(JSON.stringify(json)).not.toContain("Bearer x");
  });

  it("prefers MCPX_SECRET_<name> over the keychain without reading it", () => {
    const env = setupTempEnv("mcpx-secret-keychain-");
    cleanups.push(env.restore);
    const fake = useFake();
    switchSecretBackend("keychain");
    new SecretsManager().setSecret("alpha", "from-keychain");
    const before = fake.calls.length;

    const envName = "MCPX_SECRET_alpha";
    process.env[envName] = "from-env";
    cleanups.push(() => {
      delete process.env[envName];
    });

    expect(new SecretsManager().getSecret("alpha")).toBe("from-env");
    expect(fake.calls.length).toBe(before);
    delete process.env[envName];
    expect(new SecretsManager().getSecret("alpha")).toBe("from-keychain");
  });

  it("keeps destination-only secrets when merging into the keychain", () => {
    const env = setupTempEnv("mcpx-secret-keychain-");
    cleanups.push(env.restore);
    const fake = useFake();
    fake.seed(encodePayload({ keep: "dest", shared: "old" }));
    new SecretsManager().setSecret("shared", "new");
    new SecretsManager().setSecret("fromFile", "f");

    const result = switchSecretBackend("keychain");

    expect(result.migrated).toEqual(["fromFile", "shared"]);
    expect(result.preserved).toEqual(["keep"]);
    expect(decodePayload(fake.snapshot() ?? "").secrets).toEqual({
      keep: "dest",
      shared: "new",
      fromFile: "f"
    });
    expect(fs.existsSync(getSecretsStorePath())).toBe(false);
    expect(new SecretsManager().getSecret("keep")).toBe("dest");
  });

  it("moves keychain secrets back to the file and deletes the keychain item", () => {
    const env = setupTempEnv("mcpx-secret-keychain-");
    cleanups.push(env.restore);
    const fake = useFake();
    new SecretsManager().setSecret("alpha", "from-file");
    switchSecretBackend("keychain");
    expect(fs.existsSync(getSecretsStorePath())).toBe(false);

    const result = switchSecretBackend("file");

    expect(result.backend).toBe("file");
    expect(result.migrated).toEqual(["alpha"]);
    expect(result.removedFrom).toBe("keychain");
    expect(fake.calls.some((call) => call.args[0] === "delete-generic-password")).toBe(true);
    expect(fake.snapshot()).toBeNull();
    setSecretCommandRunnerForTests(() => {
      throw new Error("file backend should not touch the keychain");
    });
    expect(new SecretsManager().getSecret("alpha")).toBe("from-file");
    expect(fs.existsSync(getSecretsStorePath())).toBe(true);
    expect(fs.existsSync(getSecretsKeyPath())).toBe(true);
  });

  it("leaves the file store in place when the keychain write fails", () => {
    const env = setupTempEnv("mcpx-secret-keychain-");
    cleanups.push(env.restore);
    const fake = useFake();
    new SecretsManager().setSecret("alpha", "keep");
    fake.setFailWrites(true);

    expect(() => switchSecretBackend("keychain")).toThrow(/write failed/);
    expect(getSecretBackend()).toBe("file");
    expect(new SecretsManager().getSecret("alpha")).toBe("keep");
    expect(fs.existsSync(getSecretsStorePath())).toBe(true);
    expect(fs.existsSync(getSecretsKeyPath())).toBe(true);
    expect(fake.snapshot()).toBeNull();
  });

  it("leaves the file store in place when keychain verification fails", () => {
    const env = setupTempEnv("mcpx-secret-keychain-");
    cleanups.push(env.restore);
    const fake = useFake();
    fake.seed(encodePayload({ keep: "dest" }));
    new SecretsManager().setSecret("alpha", "keep");
    fake.tamperAfterHonestReads(1);

    expect(() => switchSecretBackend("keychain")).toThrow(/failed verification/);
    expect(getSecretBackend()).toBe("file");
    expect(new SecretsManager().getSecret("alpha")).toBe("keep");
    expect(fs.existsSync(getSecretsKeyPath())).toBe(true);
    expect(decodePayload(fake.snapshot() ?? "").secrets).toEqual({ keep: "dest" });
  });

  it("refuses to migrate an unreadable file store", () => {
    const env = setupTempEnv("mcpx-secret-keychain-");
    cleanups.push(env.restore);
    const fake = useFake();
    const storePath = getSecretsStorePath();
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, "garbage data\n");

    expect(() => switchSecretBackend("keychain")).toThrow(/could not be read/);
    expect(fake.calls).toEqual([]);
    expect(fs.readFileSync(storePath, "utf8")).toBe("garbage data\n");
    expect(getSecretBackend()).toBe("file");
  });

  it("refuses to overwrite an unreadable keychain payload", () => {
    const env = setupTempEnv("mcpx-secret-keychain-");
    cleanups.push(env.restore);
    const fake = useFake();
    const config = defaultConfig();
    config.secrets = { backend: "keychain" };
    saveConfig(config);
    const bad = Buffer.from("{", "utf8").toString("base64");
    fake.seed(bad);

    expect(() => new SecretsManager().getSecret("alpha")).toThrow(/could not be read/);
    expect(() => new SecretsManager().setSecret("alpha", "next")).toThrow(/could not be read/);
    expect(fake.snapshot()).toBe(bad);
  });

  it("reports that the keychain copy remains when deleting it fails", () => {
    const env = setupTempEnv("mcpx-secret-keychain-");
    cleanups.push(env.restore);
    const fake = useFake();
    new SecretsManager().setSecret("alpha", "value");
    switchSecretBackend("keychain");
    fake.setFailDeletes(true);

    expect(() => switchSecretBackend("file")).toThrow(/Secret backend is now file/);
    expect(getSecretBackend()).toBe("file");
    expect(new SecretsManager().getSecret("alpha")).toBe("value");
    expect(fake.snapshot()).not.toBeNull();
  });

  it("uses secret-tool on Linux and passes the payload on stdin", () => {
    const env = setupTempEnv("mcpx-secret-keychain-");
    cleanups.push(env.restore);
    setSecretKeychainPlatformForTests("linux");
    const fake = useFake();
    new SecretsManager().setSecret("alpha", "linux-value");

    switchSecretBackend("keychain");

    expect(fake.calls.every((call) => call.command === "secret-tool")).toBe(true);
    const store = fake.calls.find((call) => call.args[0] === "store");
    expect(store?.args).toEqual([
      "store",
      "--label", KEYCHAIN_LABEL,
      "service", KEYCHAIN_SERVICE,
      "account", KEYCHAIN_ACCOUNT
    ]);
    expect(store?.input).toBeDefined();
    expect(decodePayload(store?.input ?? "").secrets).toEqual({ alpha: "linux-value" });
    expect(fs.existsSync(getSecretsStorePath())).toBe(false);
    expect(new SecretsManager().getSecret("alpha")).toBe("linux-value");
  });

  it("reports an unsupported platform and still honors env overrides", () => {
    const env = setupTempEnv("mcpx-secret-keychain-");
    cleanups.push(env.restore);
    setSecretKeychainPlatformForTests("win32");
    new SecretsManager().setSecret("alpha", "keep");

    expect(() => switchSecretBackend("keychain")).toThrow(/not supported on win32/);
    expect(getSecretBackend()).toBe("file");
    expect(new SecretsManager().getSecret("alpha")).toBe("keep");

    const config = loadConfig();
    config.secrets = { backend: "keychain" };
    saveConfig(config);
    const envName = "MCPX_SECRET_alpha";
    process.env[envName] = "from-env";
    cleanups.push(() => {
      delete process.env[envName];
    });
    expect(new SecretsManager().getSecret("alpha")).toBe("from-env");
    expect(() => new SecretsManager().getSecret("other")).toThrow(/not supported on win32/);
  });

  it("reports a missing secret-tool without deleting the file store", () => {
    const env = setupTempEnv("mcpx-secret-keychain-");
    cleanups.push(env.restore);
    setSecretKeychainPlatformForTests("linux");
    setSecretCommandRunnerForTests(() => ({ status: 127, stdout: "", stderr: "secret-tool: not found" }));
    new SecretsManager().setSecret("alpha", "keep");

    expect(() => switchSecretBackend("keychain")).toThrow(/secret-tool/);
    expect(getSecretBackend()).toBe("file");
    expect(new SecretsManager().getSecret("alpha")).toBe("keep");
  });
});
