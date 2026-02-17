import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { getSecretNamesPath } from "./paths.js";
import { readJsonFile, writeJsonAtomic } from "../util/fs.js";

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
    if (process.platform !== "darwin") {
      throw new Error("OS keychain integration is currently implemented for macOS only.");
    }

    execFileSync("security", ["add-generic-password", "-U", "-a", name, "-s", this.service, "-w", value], {
      stdio: "ignore"
    });

    this.trackSecretName(name);
  }

  removeSecret(name: string): void {
    if (process.platform === "darwin") {
      try {
        execFileSync("security", ["delete-generic-password", "-a", name, "-s", this.service], {
          stdio: "ignore"
        });
      } catch {
        // Ignore missing keychain entry.
      }
    }

    this.untrackSecretName(name);
  }

  getSecret(name: string): string | null {
    const envOverride = process.env[`MCPX_SECRET_${name}`];
    if (envOverride && envOverride.length > 0) {
      return envOverride;
    }

    if (process.platform !== "darwin") {
      return null;
    }

    try {
      return execFileSync("security", ["find-generic-password", "-w", "-a", name, "-s", this.service], {
        encoding: "utf8"
      }).trim();
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
