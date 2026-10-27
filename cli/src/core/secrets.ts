import crypto from "node:crypto";
import fs from "node:fs";
import { z } from "zod";
import { withManagedIndexLock } from "./managed-index-lock.js";
import { ensureParentDir, getConfigPath, getSecretsKeyPath, getSecretsStorePath } from "./paths.js";
import { readJsonFile, writeJsonAtomic } from "../util/fs.js";
import { SecretNotFoundError } from "./errors.js";
import type { SecretBackendKind } from "../types.js";
import { clearKeychainSecrets, keychainUnsupportedReason, readKeychainSecrets, writeKeychainSecrets } from "./secret-keychain.js";

const ALGORITHM = "aes-256-gcm";
const UNREADABLE_FILE_STORE = "The encrypted credentials store could not be read. Restore its original key or backup before changing credentials. Existing files have been preserved.";
// Keychain prompts can block the process that holds the secrets lock.
const SECRET_LOCK_TIMEOUT_MS = 120_000;

interface EncryptedEnvelope {
  version: number;
  algorithm: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

interface SecretsData {
  secrets: Record<string, string>;
}
const secretsDataSchema = z.object({ secrets: z.record(z.string(), z.string()) });
const secretBackendSchema = z.object({
  backend: z.enum(["file", "keychain"]).default("file")
});

export interface SecretBackendSwitchResult {
  backend: SecretBackendKind;
  changed: boolean;
  migrated: string[];
  preserved: string[];
  removedFrom: SecretBackendKind | null;
}

export function describeSecretBackend(backend: SecretBackendKind): string {
  if (backend === "keychain") {
    return "OS keychain (macOS Keychain via the security command, or Linux libsecret via secret-tool). The operating system protects the secrets and may prompt for access. A locked session or a missing secret service cannot unlock them, and the background gateway waits while that prompt is open.";
  }
  return "AES-256-GCM encrypted file (secrets.json + secrets.key in the data directory). The encryption key sits next to the ciphertext, so other programs running as your user can read these secrets. No system prompts, and it works in headless sessions.";
}

export function getSecretBackend(configPath = getConfigPath()): SecretBackendKind {
  if (!fs.existsSync(configPath)) return "file";
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    throw new Error(`Config file at ${configPath} is not valid JSON, so the secret backend could not be determined.`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`Config file at ${configPath} is not a JSON object, so the secret backend could not be determined.`);
  }
  const secrets = (raw as { secrets?: unknown }).secrets;
  if (secrets === undefined) return "file";
  const parsed = secretBackendSchema.safeParse(secrets);
  if (!parsed.success) {
    throw new Error(`Invalid secrets.backend in ${configPath}. Expected "file" or "keychain".`);
  }
  return parsed.data.backend;
}

function loadKey(keyPath: string): Buffer {
  try {
    const stored = fs.readFileSync(keyPath, "utf8").trim();
    return Buffer.from(stored, "base64");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  ensureParentDir(keyPath);
  const key = crypto.randomBytes(32);
  try {
    fs.writeFileSync(keyPath, key.toString("base64") + "\n", { flag: "wx", mode: 0o600 });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      const stored = fs.readFileSync(keyPath, "utf8").trim();
      return Buffer.from(stored, "base64");
    }
    throw err;
  }
  return key;
}

function readSecretsData(storePath: string, keyPath: string): SecretsData | null {
  const envelope = readJsonFile<EncryptedEnvelope | null>(storePath, null);
  if (!envelope || envelope.version !== 1 || envelope.algorithm !== ALGORITHM) return null;

  try {
    // Reading an existing vault must never generate a replacement encryption key.
    const key = Buffer.from(fs.readFileSync(keyPath, "utf8").trim(), "base64");
    const iv = Buffer.from(envelope.iv, "base64");
    const authTag = Buffer.from(envelope.authTag, "base64");
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return secretsDataSchema.parse(JSON.parse(decrypted.toString("utf8")));
  } catch {
    return null;
  }
}

function buildEnvelope(keyPath: string, data: unknown): EncryptedEnvelope {
  const key = loadKey(keyPath);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const plaintext = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    version: 1,
    algorithm: ALGORITHM,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };
}

function readFileSecretsLoose(storePath: string, keyPath: string): Record<string, string> | null {
  return readSecretsData(storePath, keyPath)?.secrets ?? null;
}

function readFileSecretsStrict(storePath: string, keyPath: string): Record<string, string> {
  const map = readFileSecretsLoose(storePath, keyPath);
  if (map === null && fs.existsSync(storePath)) {
    throw new Error(UNREADABLE_FILE_STORE);
  }
  return map ?? {};
}

function writeFileSecrets(storePath: string, keyPath: string, secrets: Record<string, string>): void {
  const envelope = buildEnvelope(keyPath, { secrets });
  writeJsonAtomic(storePath, envelope);
}

function clearFileSecrets(storePath: string, keyPath: string): void {
  fs.rmSync(storePath, { force: true });
  fs.rmSync(keyPath, { force: true });
}

function readBackendSecrets(backend: SecretBackendKind, storePath: string, keyPath: string): Record<string, string> {
  if (backend === "keychain") return readKeychainSecrets();
  return readFileSecretsStrict(storePath, keyPath);
}

function writeBackendSecrets(backend: SecretBackendKind, storePath: string, keyPath: string, secrets: Record<string, string>): void {
  if (backend === "keychain") {
    writeKeychainSecrets(secrets);
    return;
  }
  writeFileSecrets(storePath, keyPath, secrets);
}

function clearBackendSecrets(backend: SecretBackendKind, storePath: string, keyPath: string): void {
  if (backend === "keychain") {
    clearKeychainSecrets();
    return;
  }
  clearFileSecrets(storePath, keyPath);
}

function secretsMatch(expected: Record<string, string>, actual: Record<string, string>): boolean {
  const expectedNames = Object.keys(expected);
  if (expectedNames.length !== Object.keys(actual).length) return false;
  return expectedNames.every((name) => actual[name] === expected[name]);
}

function persistSecretBackend(backend: SecretBackendKind, configPath: string): void {
  let raw: Record<string, unknown>;
  if (fs.existsSync(configPath)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch {
      throw new Error(`Config file at ${configPath} is not valid JSON, so the secret backend was not changed.`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`Config file at ${configPath} is not a JSON object, so the secret backend was not changed.`);
    }
    raw = parsed as Record<string, unknown>;
  } else {
    raw = {};
  }
  const existing = typeof raw.secrets === "object" && raw.secrets !== null && !Array.isArray(raw.secrets)
    ? raw.secrets as Record<string, unknown>
    : {};
  raw.secrets = { ...existing, backend };
  writeJsonAtomic(configPath, raw);
}

export function switchSecretBackend(target: SecretBackendKind, configPath = getConfigPath()): SecretBackendSwitchResult {
  if (target !== "file" && target !== "keychain") {
    throw new Error(`Unknown secret backend "${String(target)}". Use "file" or "keychain".`);
  }
  const storePath = getSecretsStorePath();
  const keyPath = getSecretsKeyPath();
  return withManagedIndexLock(`${storePath}.lock`, () => {
    const current = getSecretBackend(configPath);
    if (current === target) {
      return { backend: target, changed: false, migrated: [], preserved: [], removedFrom: null };
    }
    if (current === "keychain" || target === "keychain") {
      const reason = keychainUnsupportedReason();
      if (reason) throw new Error(reason);
    }

    const source = readBackendSecrets(current, storePath, keyPath);
    const destination = readBackendSecrets(target, storePath, keyPath);
    const merged: Record<string, string> = { ...destination, ...source };
    writeBackendSecrets(target, storePath, keyPath, merged);
    const readBack = readBackendSecrets(target, storePath, keyPath);
    if (!secretsMatch(merged, readBack)) {
      try {
        writeBackendSecrets(target, storePath, keyPath, destination);
      } catch (restoreErr) {
        const detail = restoreErr instanceof Error ? restoreErr.message : String(restoreErr);
        throw new Error(`Migration to ${target} failed verification and the previous ${target} copy could not be restored: ${detail}. The ${current} backend was left unchanged.`);
      }
      throw new Error(`Migration to ${target} failed verification. The ${current} backend was left unchanged.`);
    }

    persistSecretBackend(target, configPath);
    try {
      clearBackendSecrets(current, storePath, keyPath);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`Secret backend is now ${target}, but secrets could not be removed from the ${current} store: ${detail}`);
    }

    const preserved = Object.keys(destination)
      .filter((name) => !Object.prototype.hasOwnProperty.call(source, name))
      .sort();
    return {
      backend: target,
      changed: true,
      migrated: Object.keys(source).sort(),
      preserved,
      removedFrom: current
    };
  }, SECRET_LOCK_TIMEOUT_MS);
}

function parseSecretRef(ref: string): string | null {
  if (!ref.startsWith("secret://")) return null;
  const name = ref.slice("secret://".length);
  return name.length > 0 ? name : null;
}

export class SecretsManager {
  private readonly storePath: string;
  private readonly keyPath: string;

  constructor(storePath = getSecretsStorePath(), keyPath = getSecretsKeyPath()) {
    this.storePath = storePath;
    this.keyPath = keyPath;
  }

  get backend(): SecretBackendKind {
    return getSecretBackend();
  }

  listSecretNames(): string[] {
    if (this.backend === "keychain") {
      return Object.keys(readKeychainSecrets()).sort();
    }
    return Object.keys(readFileSecretsLoose(this.storePath, this.keyPath) ?? {}).sort();
  }

  setSecret(name: string, value: string): void {
    return withManagedIndexLock(`${this.storePath}.lock`, () => {
      if (this.backend === "keychain") {
        const map = readKeychainSecrets();
        map[name] = value;
        writeKeychainSecrets(map);
        return;
      }
      const map = readFileSecretsStrict(this.storePath, this.keyPath);
      map[name] = value;
      writeFileSecrets(this.storePath, this.keyPath, map);
    }, SECRET_LOCK_TIMEOUT_MS);
  }

  removeSecret(name: string): void {
    return withManagedIndexLock(`${this.storePath}.lock`, () => {
      if (this.backend === "keychain") {
        const map = readKeychainSecrets();
        if (!(name in map)) return;
        delete map[name];
        writeKeychainSecrets(map);
        return;
      }
      const map = readFileSecretsStrict(this.storePath, this.keyPath);
      if (!(name in map)) return;
      delete map[name];
      writeFileSecrets(this.storePath, this.keyPath, map);
    }, SECRET_LOCK_TIMEOUT_MS);
  }

  getSecret(name: string): string | null {
    const envOverride = process.env[`MCPX_SECRET_${name}`];
    if (envOverride && envOverride.length > 0) return envOverride;

    if (this.backend === "keychain") {
      return readKeychainSecrets()[name] ?? null;
    }
    return (readFileSecretsLoose(this.storePath, this.keyPath) ?? {})[name] ?? null;
  }

  resolveMaybeSecret(value: string): string {
    const secretName = parseSecretRef(value);
    if (!secretName) return value;

    const secret = this.getSecret(secretName);
    if (!secret) throw new SecretNotFoundError(secretName);
    return secret;
  }

  rotateLocalToken(secretName = "local_gateway_token"): string {
    const token = crypto.randomBytes(32).toString("base64url");
    this.setSecret(secretName, token);
    return token;
  }
}

export function readSecretValueFromStdin(): string {
  if (process.stdin.isTTY) {
    throw new Error("No value provided. Use --value or pipe a value via stdin.");
  }

  const content = fs.readFileSync(process.stdin.fd, "utf8").trim();
  if (content.length === 0) {
    throw new Error("Empty secret value provided.");
  }

  return content;
}
