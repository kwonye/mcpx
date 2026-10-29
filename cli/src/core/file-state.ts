import fs from "node:fs";
import path from "node:path";
import { sha256 } from "../util/fs.js";

/** Windows junctions store an absolute target, often with a `\\?\` prefix. Planned links are relative to the link. */
export function normalizeLinkContent(linkPath: string, raw: string): string {
  if (process.platform !== "win32") return raw;
  const paths = path.win32;
  let target = raw;
  if (target.startsWith("\\\\?\\UNC\\")) target = `\\\\${target.slice(8)}`;
  else if (target.startsWith("\\\\?\\")) target = target.slice(4);
  if (!/^[a-zA-Z]:\\?$/.test(target)) target = target.replace(/[\\/]+$/, "");
  if (!paths.isAbsolute(target)) return target.replaceAll("/", "\\");
  return paths.relative(paths.dirname(linkPath), target);
}

/** Hash the directory entry itself; never traverse a symlink into another tree. */
export function pathFingerprint(target: string): string | null {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return sha256(`link:${normalizeLinkContent(target, fs.readlinkSync(target))}`);
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
