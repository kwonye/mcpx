import crypto from "node:crypto";
import fs from "node:fs";
import { getSecretNamesPath } from "./paths.js";
import { readJsonFile, writeJsonAtomic } from "../util/fs.js";

// keytar is optional — gracefully degrade if native addon fails to load.
// keytar's JS implementation is synchronous; the types declare Promises.
// We access the underlying sync functions directly.
let keytarSync: {
  getPassword: (service: string, account: string) => string;
  setPassword: (service: string, account: string, password: string) => void;
  deletePassword: (service: string, account: string) => boolean;
} | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const keytar = require("../node_modules/keytar/lib/keytar.js") as {
    getPassword: (service: string, account: string) => string;
    setPassword: (service: string, account: string, password: string) => void;
    deletePassword: (service: string, account: string) => boolean;
  };
  keytarSync = keytar;
} catch {
  keytarSync = null;
}

interface SecretNameIndex {
  names: string[];
}

function parseSecretRef(ref: string): string | null {
  if (!ref.startsWith("secret://")) {
    return null;
  }
  const name = ref.slice("secret://".length);
  return name.length > 0 ? name : null;
}

export class SecretsManager {
  private readonly service: string;
  private readonly nameIndexPath: string;

  constructor(service = "mcpx", nameIndexPath = getSecretNamesPath()) {
    this.service = service;
    this.nameIndexPath = nameIndexPath;
  }

  private loadNameIndex(): SecretNameIndex {
    return readJsonFile(this.nameIndexPath, { names: [] as string[] });
  }

  private saveNameIndex(index: SecretNameIndex): void {
    const deduped = Array.from(new Set(index.names)).sort();
    writeJsonAtomic(this.nameIndexPath, { names: deduped });
  }

  private trackSecretName(name: string): void {
    const index = this.loadNameIndex();
    if (!index.names.includes(name)) {
      index.names.push(name);
      this.saveNameIndex(index);
    }
  }

  private untrackSecretName(name: string): void {
    const index = this.loadNameIndex();
    index.names = index.names.filter((entry) => entry !== name);
    this.saveNameIndex(index);
  }

  listSecretNames(): string[] {
    return this.loadNameIndex().names;
  }

  setSecret(name: string, value: string): void {
    if (keytarSync) {
      keytarSync.setPassword(this.service, name, value);
    } else {
      throw new Error(
        "Secret storage is unavailable: keytar native addon failed to load. " +
          "Install libsecret (Linux) or ensure Xcode CLI tools (macOS), then reinstall dependencies."
      );
    }

    this.trackSecretName(name);
  }

  removeSecret(name: string): void {
    if (keytarSync) {
      try {
        keytarSync.deletePassword(this.service, name);
      } catch {
        // Ignore missing entry.
      }
    }

    this.untrackSecretName(name);
  }

  getSecret(name: string): string | null {
    const envOverride = process.env[`MCPX_SECRET_${name}`];
    if (envOverride && envOverride.length > 0) {
      return envOverride;
    }

    if (!keytarSync) {
      return null;
    }

    try {
      const value = keytarSync.getPassword(this.service, name);
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
      return null;
    } catch {
      return null;
    }
  }

  resolveMaybeSecret(value: string): string {
    const secretName = parseSecretRef(value);
    if (!secretName) {
      return value;
    }

    const secret = this.getSecret(secretName);
    if (!secret) {
      throw new Error(`Secret not found: ${secretName}`);
    }

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
