import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { z } from "zod";
import TOML from "@iarna/toml";
import YAML from "yaml";
import { getConfigPath } from "./paths.js";
import { getStateRoot } from "./paths.js";
import { SecretsManager } from "./secrets.js";
import { writeJsonAtomic, sha256 } from "../util/fs.js";

export interface Operation {
  id: string;
  label: string;
  phase: "prepared" | "applying" | "complete" | "failed" | "rolled-back" | "recovery-required";
  startedAt: string;
  updatedAt: string;
  progress: number;
  message?: string;
  undoable?: boolean;
  details?: string[];
}
export const operationEvents = new EventEmitter();
const operationSchema = z.object({ id: z.uuid(), label: z.string(), phase: z.enum(["prepared", "applying", "complete", "failed", "rolled-back", "recovery-required"]), startedAt: z.string(), updatedAt: z.string(), progress: z.number(), message: z.string().optional(), undoable: z.boolean().optional(), details: z.array(z.string()).optional() });
const snapshotSchema = z.object({ kind: z.enum(["missing", "file", "directory", "link"]), content: z.string().optional(), files: z.record(z.string(), z.object({ kind: z.enum(["file", "directory", "link"]), content: z.string().optional(), mode: z.number().optional() })).optional(), mode: z.number().optional() });
export type FileSnapshot = z.infer<typeof snapshotSchema>;
export interface PlannedWrite { path: string; before: FileSnapshot; after: FileSnapshot }
const writesSchema = z.array(z.object({ path: z.string(), before: snapshotSchema, after: snapshotSchema }));
function root() { return path.join(getStateRoot(), "mcpx", "operations"); }
function operationPath(id: string) { return path.join(root(), `${z.uuid().parse(id)}.json`); }
export function snapshot(target: string): FileSnapshot {
  let stat: fs.Stats;
  try { stat = fs.lstatSync(target); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" }; throw error; }
  if (stat.isSymbolicLink()) return { kind: "link", content: fs.readlinkSync(target) };
  if (!stat.isDirectory()) return { kind: "file", content: fs.readFileSync(target).toString("base64"), mode: stat.mode & 0o777 };
  const files: NonNullable<FileSnapshot["files"]> = {};
  let bytes = 0;
  function walk(dir: string, prefix = "") {
    for (const name of fs.readdirSync(dir).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name;
      const full = path.join(dir, name);
      const info = fs.lstatSync(full);
      if (info.isSymbolicLink()) files[relative] = { kind: "link", content: fs.readlinkSync(full) };
      else if (info.isDirectory()) { files[relative] = { kind: "directory", mode: info.mode & 0o777 }; walk(full, relative); }
      else if (info.isFile()) {
        bytes += info.size;
        if (bytes > 64 * 1024 * 1024) throw new Error("Package exceeds the 64 MB adoption snapshot limit; install a pinned source through mcpx instead.");
        files[relative] = { kind: "file", content: fs.readFileSync(full).toString("base64"), mode: info.mode & 0o777 };
      } else throw new Error("Cannot adopt special filesystem entries.");
    }
  }
  walk(target);
  return { kind: "directory", files, mode: stat.mode & 0o777 };
}
export function snapshotHash(value: FileSnapshot): string { return sha256(JSON.stringify(value)); }
export function textSnapshot(content: string): FileSnapshot { return { kind: "file", content: Buffer.from(content).toString("base64"), mode: 0o600 }; }
export function snapshotText(value: FileSnapshot): string { return value.content ? Buffer.from(value.content, "base64").toString("utf8") : ""; }
export function writeSnapshot(target: string, state: FileSnapshot): void {
  if (state.kind === "missing") { fs.rmSync(target, { recursive: true, force: true }); return; }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.mcpx-${crypto.randomUUID()}`;
  try {
    if (state.kind === "file") fs.writeFileSync(temp, Buffer.from(state.content!, "base64"), { mode: state.mode ?? 0o600 });
    else if (state.kind === "link") fs.symlinkSync(state.content!, temp, process.platform === "win32" ? "junction" : undefined);
    else {
      fs.mkdirSync(temp, { mode: state.mode ?? 0o700 });
      for (const [relative, entry] of Object.entries(state.files ?? {})) {
        const dest = path.resolve(temp, relative);
        if (!dest.startsWith(path.resolve(temp) + path.sep)) throw new Error("Invalid snapshot path");
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (entry.kind === "directory") fs.mkdirSync(dest, { recursive: true, mode: entry.mode ?? 0o700 });
        else if (entry.kind === "link") fs.symlinkSync(entry.content!, dest);
        else fs.writeFileSync(dest, Buffer.from(entry.content!, "base64"), { mode: entry.mode ?? 0o600 });
      }
    }
    const existing = snapshot(target);
    if (existing.kind === "directory" || (state.kind === "directory" && existing.kind !== "missing")) fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(temp, target);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
export function saveOperation(operation: Operation): void {
  operation.updatedAt = new Date().toISOString();
  writeJsonAtomic(operationPath(operation.id), operation);
  operationEvents.emit("change", operation);
}
export function listOperations(): Operation[] {
  if (!fs.existsSync(root())) return [];
  return fs.readdirSync(root()).filter(name => name.endsWith(".json")).flatMap(name => {
    try { const parsed = operationSchema.safeParse(JSON.parse(fs.readFileSync(path.join(root(), name), "utf8"))); return parsed.success ? [parsed.data] : []; }
    catch { return []; }
  }).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** Complete write intents are encrypted before the first filesystem mutation. */
export function applyWrites(label: string, writes: PlannedWrite[], id: string = crypto.randomUUID(), details: string[] = []): Operation {
  for (const write of writes) if (snapshotHash(snapshot(write.path)) !== snapshotHash(write.before)) throw new Error(`Configuration changed since planning: ${write.path}`);
  const secrets = new SecretsManager();
  secrets.setSecret(`operation_${id}`, JSON.stringify(writes));
  const operation: Operation = { id, label, details, undoable: true, phase: "prepared", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), progress: 0 };
  saveOperation(operation);
  try {
    for (const [index, write] of writes.entries()) {
      if (snapshotHash(snapshot(write.path)) !== snapshotHash(write.before)) throw new Error("A file changed during application; recovery is required.");
      operation.phase = "applying";
      operation.progress = index / Math.max(writes.length, 1);
      saveOperation(operation);
      writeSnapshot(write.path, write.after);
      if (snapshotHash(snapshot(write.path)) !== snapshotHash(write.after)) throw new Error("Projection verification failed.");
    }
    operation.phase = "complete";
    operation.progress = 1;
    saveOperation(operation);
    return operation;
  } catch (error) {
    operation.phase = "recovery-required";
    operation.message = "The operation did not complete. Undo it from Activity to recover safely.";
    saveOperation(operation);
    throw error;
  }
}

function parseDoc(file: string, text: string): Record<string, any> {
  return z.record(z.string(), z.unknown()).parse(file.endsWith(".toml") ? TOML.parse(text) : /\.ya?ml$/.test(file) ? YAML.parse(text) : JSON.parse(text));
}
function stringifyDoc(file: string, value: Record<string, any>) { return file.endsWith(".toml") ? TOML.stringify(value as never) : /\.ya?ml$/.test(file) ? YAML.stringify(value) : JSON.stringify(value, null, 2) + "\n"; }
function equal(a: unknown, b: unknown, ignored = new Set<string>()): boolean {
  const normalize = (value: any): any => Array.isArray(value) ? value.map(normalize) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).filter(key => !ignored.has(key)).sort().map(key => [key, normalize(value[key])])) : value;
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
/** Three-way undo changes only values written by the operation. */
function undoValue(before: any, after: any, current: any, ignored = new Set<string>()): any {
  if (equal(before, after, ignored)) return current;
  if (equal(current, after, ignored)) return before;
  if (equal(current, before, ignored)) return current;
  const object = (value: any) => value && typeof value === "object" && !Array.isArray(value);
  if (object(after) && object(current) && (object(before) || before === undefined)) {
    const next = { ...current };
    for (const key of new Set([...Object.keys(before ?? {}), ...Object.keys(after)])) {
      if (ignored.has(key)) continue;
      const result = undoValue(before?.[key], after[key], current[key], ignored);
      if (result === undefined) delete next[key]; else next[key] = result;
    }
    return next;
  }
  throw new Error("An affected value was edited after this operation. Preserve it and resolve the conflict before undoing.");
}
export function rollbackOperation(id: string): Operation {
  const operation = operationSchema.parse(JSON.parse(fs.readFileSync(operationPath(id), "utf8")));
  if (operation.phase === "rolled-back") return operation;
  const backup = new SecretsManager().getSecret(`operation_${id}`);
  if (!backup) throw new Error("Encrypted recovery receipt is unavailable.");
  const writes = writesSchema.parse(JSON.parse(backup));
  const undo: PlannedWrite[] = [];
  for (const write of [...writes].reverse()) {
    const current = snapshot(write.path);
    if (snapshotHash(current) === snapshotHash(write.before)) continue;
    let restored = write.before;
    if (write.path === getConfigPath() && current.kind === "file") {
      const now = parseDoc(write.path, snapshotText(current));
      const before = write.before.kind === "missing" ? {} : parseDoc(write.path, snapshotText(write.before));
      const after = parseDoc(write.path, snapshotText(write.after));
      const revision = now.revision ?? 0;
      before.revision = after.revision = revision;
      const result = undoValue(before, after, now, new Set(["revision", "lastSyncAt", "lastSyncedAt"]));
      result.revision = revision + 1;
      restored = textSnapshot(stringifyDoc(write.path, result));
    } else if (operation.phase === "recovery-required" && current.kind === "missing" && write.before.kind !== "missing") {
      // A directory replacement can stop after removal and before rename.
      // Nothing occupies the path, so restoring its receipt cannot overwrite edits.
      restored = write.before;
    } else if (snapshotHash(current) !== snapshotHash(write.after)) {
      if (current.kind === "file" && write.after.kind === "file" && ["file", "missing"].includes(write.before.kind) && /\.(json|toml|ya?ml)$/.test(write.path)) {
        const before = write.before.kind === "missing" ? {} : parseDoc(write.path, snapshotText(write.before));
        const result = undoValue(before, parseDoc(write.path, snapshotText(write.after)), parseDoc(write.path, snapshotText(current)), write.path.endsWith("managed-index.json") ? new Set(["lastSyncedAt"]) : undefined);
        restored = textSnapshot(stringifyDoc(write.path, result));
      } else throw new Error(`Local edits prevent undo: ${write.path}`);
    }
    undo.push({ path: write.path, before: current, after: restored });
  }
  // Validate every precondition before applying any undo.
  applyWrites(`Undo ${operation.label}`, undo);
  operation.phase = "rolled-back";
  operation.progress = 1;
  saveOperation(operation);
  return operation;
}
export function markInterruptedOperations(): void {
  for (const operation of listOperations()) if (operation.phase === "prepared" || operation.phase === "applying") {
    operation.phase = "recovery-required";
    operation.message = "mcpx stopped during this operation. Undo it to restore the previous state.";
    saveOperation(operation);
  }
}
