import fs from "node:fs";
import path from "node:path";
import { sha256 } from "../util/fs.js";

/** Hash the directory entry itself; never traverse a symlink into another tree. */
export function pathFingerprint(target: string): string | null {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return sha256(`link:${fs.readlinkSync(target)}`);
    if (stat.isDirectory()) return sha256(JSON.stringify(fs.readdirSync(target).sort().map(name => [name, pathFingerprint(path.join(target, name))])));
    return sha256(fs.readFileSync(target).toString("base64"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function processAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

export function lockOwnerAlive(lockPath: string): boolean {
  try {
    const owner = Number(fs.readFileSync(lockPath, "utf8").trim());
    if (!owner && Date.now() - fs.statSync(lockPath).mtimeMs < 2000) return true;
    return processAlive(owner);
  } catch { return false; }
}
