import crypto from "node:crypto";
import fs from "node:fs";
import { getSecretsStorePath, getSecretsKeyPath, ensureParentDir } from "./paths.js";
import { readJsonFile, writeJsonAtomic } from "../util/fs.js";
import { SecretNotFoundError } from "./errors.js";

const ALGORITHM = "aes-256-gcm";

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
    const key = loadKey(keyPath);
    const iv = Buffer.from(envelope.iv, "base64");
    const authTag = Buffer.from(envelope.authTag, "base64");
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8"));
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

  private readStore(): Record<string, string> | null {
    const data = readSecretsData(this.storePath, this.keyPath);
    return data?.secrets ?? null;
  }

  private recoverCorruptStore(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        fs.renameSync(this.storePath, `${this.storePath}.corrupt-${Date.now()}`);
      }
    } catch {
      // best effort
    }
  }

  listSecretNames(): string[] {
    return Object.keys(this.readStore() ?? {}).sort();
  }

  setSecret(name: string, value: string): void {
    let map = this.readStore();
    if (map === null) {
      this.recoverCorruptStore();
      map = {};
    }
    map[name] = value;
    const envelope = buildEnvelope(this.keyPath, { secrets: map });
    writeJsonAtomic(this.storePath, envelope);
  }

  removeSecret(name: string): void {
    const map = this.readStore() ?? {};
    delete map[name];
    const envelope = buildEnvelope(this.keyPath, { secrets: map });
    writeJsonAtomic(this.storePath, envelope);
  }

  getSecret(name: string): string | null {
    const envOverride = process.env[`MCPX_SECRET_${name}`];
    if (envOverride && envOverride.length > 0) return envOverride;

    return (this.readStore() ?? {})[name] ?? null;
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
