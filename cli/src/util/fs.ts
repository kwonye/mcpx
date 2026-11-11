import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function fsyncBestEffort(descriptor: number): void {
  try {
    fs.fsyncSync(descriptor);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Windows returns EPERM for fsync on directories and on some new files.
    if (code === "EPERM" || code === "EINVAL" || code === "ENOTSUP") return;
    throw error;
  }
}

export function writeJsonAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const content = `${JSON.stringify(data, null, 2)}\n`;
  const descriptor = fs.openSync(tempPath, "w", 0o600);
  try { fs.writeFileSync(descriptor, content); fsyncBestEffort(descriptor); } finally { fs.closeSync(descriptor); }
  fs.renameSync(tempPath, filePath);
  if (process.platform !== "win32") {
    const directory = fs.openSync(path.dirname(filePath), "r");
    try { fsyncBestEffort(directory); } finally { fs.closeSync(directory); }
  }
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function safeReadFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

/** Native configuration must fail closed; malformed files are never reset. */
export function readJsonStrict<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
    return value as T;
  } catch { throw new Error(`Native configuration is invalid JSON: ${filePath}`); }
}
