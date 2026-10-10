import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { z } from "zod";
import type { Skill } from "../types.js";
import YAML from "yaml";
import { readNativeDocument, nativeServers, writeNativeDocument } from "./native-document.js";
import { pathFingerprint } from "./file-state.js";
import { verifyUpstreams } from "./verify-upstreams.js";
import { installationAdapters, type HarnessInstallation } from "./harnesses.js";
import { loadConfig } from "./config.js";
import { getConfigPath, getManagedIndexPath, getSkillPackagesRoot, getDataRoot } from "./paths.js";
import { loadManagedIndex } from "./managed-index.js";
import { serializeServerSpec } from "../adapters/utils/index.js";
import type { ClientImportCandidate, McpxConfig, UpstreamServerSpec } from "../types.js";
import { consumerToken } from "./consumers.js";
import { SecretsManager } from "./secrets.js";
import { sha256, writeJsonAtomic } from "../util/fs.js";
import { applyWrites, snapshot, snapshotHash, snapshotText, textSnapshot, writeSnapshot, type PlannedWrite, type FileSnapshot } from "./operations.js";
import { listSkills } from "./skills.js";
import { validateSkillPackage } from "./skills.js";

const itemSchema = z.object({ id: z.string(), harness: z.string(), kind: z.enum(["mcp", "skill", "package"]), name: z.string(), path: z.string(), nativeKey: z.string(), fingerprint: z.string(), action: z.enum(["import", "reuse", "conflict", "unsupported"]), canonicalId: z.string(), reason: z.string().optional(), reload: z.string() });
export const adoptionPlanSchema = z.object({ id: z.uuid(), createdAt: z.string(), configHash: z.string(), items: z.array(itemSchema), errors: z.array(z.string()) });
export type AdoptionPlan = z.infer<typeof adoptionPlanSchema>;
export type AdoptionItem = z.infer<typeof itemSchema>;
interface Candidate { item: AdoptionItem; installation: HarnessInstallation; server?: ClientImportCandidate; content?: FileSnapshot; sourceRoot?: string; packageMode?: "settings" | "directory"; packageIdentity?: string }
function cleanName(value: string) { return value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").replace(/-+/g, "-").slice(0, 50) || "integration"; }
function serverIdentity(spec: UpstreamServerSpec, secrets: SecretsManager) {
  const copy = structuredClone(spec);
  const values = copy.transport === "http" ? copy.headers : copy.env;
  for (const [key, value] of Object.entries(values ?? {})) if (value.startsWith("secret://")) values![key] = secrets.resolveMaybeSecret(value);
  return sha256(serializeServerSpec(copy));
}
function packageIdentityBase(identity: string) { return identity.replace(/:project:[a-f0-9]{8}$/, ""); }
function packageOwnershipMatches(pkg: NonNullable<McpxConfig["packages"]>[string] | undefined, candidate: Candidate) {
  const scope = candidate.installation.projectPath;
  if (!pkg || pkg.scope !== scope) return false;
  return pkg.identity === candidate.packageIdentity || Boolean(scope && pkg.identity === packageIdentityBase(candidate.packageIdentity ?? ""));
}
export function protectServerSecrets(name: string, spec: UpstreamServerSpec, secrets = new SecretsManager()): UpstreamServerSpec {
  const copy = structuredClone(spec);
  const values = copy.transport === "http" ? copy.headers : copy.env;
  for (const [key, value] of Object.entries(values ?? {})) {
    if (!value || /^(secret|oauth):\/\//.test(value)) continue;
    if (copy.transport === "http" || /key|token|secret|password|credential|authorization/i.test(key)) {
      const secretName = `adopt_${sha256(`${name}:${key}:${value}`).slice(0, 32)}`;
      secrets.setSecret(secretName, value);
      values![key] = `secret://${secretName}`;
    }
  }
  return copy;
}

function packageCandidate(config: McpxConfig, installation: HarnessInstallation, content: FileSnapshot, sourceRoot: string, nativePath: string, nativeKey: string, name: string, identity: string, mode: "settings" | "directory"): Candidate {
  const fingerprint = snapshotHash(content);
  const scopeSuffix = installation.projectPath ? `:project:${sha256(path.resolve(installation.projectPath)).slice(0, 8)}` : "";
  const legacyIdentity = scopeSuffix && identity.endsWith(scopeSuffix) ? identity.slice(0, -scopeSuffix.length) : undefined;
  const existing = Object.values(config.packages ?? {}).find(pkg => pkg.identity === identity) ?? (legacyIdentity ? Object.values(config.packages ?? {}).find(pkg => pkg.identity === legacyIdentity && pkg.scope === installation.projectPath) : undefined);
  const changed = existing && existing.fingerprint !== fingerprint;
  const canonicalScope = installation.projectPath ? `-${sha256(path.resolve(installation.projectPath)).slice(0, 8)}` : "";
  return { installation, content, sourceRoot, packageMode: mode, packageIdentity: identity, item: { id: sha256(`${installation.id}:package:${nativePath}:${nativeKey}`).slice(0, 24), harness: installation.id, kind: "package", name, path: nativePath, nativeKey, fingerprint: sha256(`${snapshotHash(snapshot(nativePath))}:${fingerprint}`), canonicalId: existing?.id ?? `${name}-${fingerprint.slice(0, 12)}${canonicalScope}`, action: changed && existing.pinned ? "conflict" : existing && !changed ? "reuse" : "import", reason: changed && existing.pinned ? "This package is pinned. Unpin it in Library before adopting an update." : changed ? "Update the managed package to this native revision." : undefined, reload: installation.reload } };
}

function managedPackageAtLoadRoot(config: McpxConfig, sourcePath: string) {
  const resolvedSource = path.resolve(sourcePath);
  return Object.values(config.packages ?? {}).find(pkg => {
    if (path.resolve(pkg.root) === resolvedSource) return true;
    const revision = pkg.fingerprint.slice(0, 16);
    const projection = path.join(getDataRoot(), "mcpx", "packages", "projections", pkg.id, revision);
    return path.resolve(projection) === resolvedSource;
  });
}

function scan(config: McpxConfig, targets?: string[]): { candidates: Candidate[]; errors: string[] } {
  const candidates: Candidate[] = [];
  const errors: string[] = [];
  const index = loadManagedIndex();
  const secrets = new SecretsManager();
  const identities = new Map<string, string>();
  for (const [name, spec] of Object.entries(config.servers)) {
    try { identities.set(`${spec.scope ?? "global"}:${serverIdentity(spec, secrets)}`, name); } catch { /* unresolved credentials are not equivalent */ }
  }
  const names = new Set(Object.keys(config.servers));
  const skillNames = new Map<string, string>();
  for (const skill of listSkills()) skillNames.set(skill.id, snapshotHash(skill.root ? snapshot(skill.root) : { kind: "directory", files: { "SKILL.md": { kind: "file", content: Buffer.from(skill.content).toString("base64"), mode: 0o600 } }, mode: 0o755 }));
  for (const { installation, adapter } of installationAdapters(config)) {
    if (targets?.length && !targets.includes(installation.id)) continue;
    try {
      const result = adapter.scanForImports(config, index);
      for (const skipped of result.skipped) errors.push(`${installation.label}: ${skipped.sourceEntryName}: ${skipped.reason}`);
      for (const server of result.candidates) {
        const file = server.configPath ?? installation.configPath;
        if (!file) continue;
        const identity = serverIdentity(server.spec, secrets);
        const scope = installation.projectPath ?? "global";
        const existing = identities.get(`${scope}:${identity}`);
        let canonicalId = existing ?? (installation.projectPath ? `${cleanName(server.serverName).slice(0, 35)}-${sha256(installation.projectPath).slice(0, 8)}` : cleanName(server.serverName));
        const collision = !existing && names.has(canonicalId);
        const unsafe = /\$\{|^!/m.test(JSON.stringify(server.spec));
        const item: AdoptionItem = { id: sha256(`${installation.id}:mcp:${file}:${server.sourceEntryName}`).slice(0, 24), harness: installation.id, kind: "mcp", name: server.serverName, path: file, nativeKey: server.sourceEntryName, fingerprint: snapshotHash(snapshot(file)), canonicalId, action: unsafe ? "unsupported" : collision ? "conflict" : existing ? "reuse" : "import", reason: unsafe ? "Native variable or command interpolation needs explicit configuration before adoption." : collision ? "The name already belongs to a different configuration. Rename it before adopting." : undefined, reload: installation.reload };
        if (!unsafe && !collision) { identities.set(`${scope}:${identity}`, canonicalId); names.add(canonicalId); }
        candidates.push({ item, installation, server });
      }
      for (const directory of installation.skillPaths) {
        if (!fs.existsSync(directory)) continue;
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          if (!entry.isDirectory() && !(entry.isFile() && entry.name.endsWith(".md"))) continue;
          const manifestPath = path.join(directory, "mcpx-skills.json");
          if (fs.existsSync(manifestPath)) {
            const owned = z.object({ paths: z.array(z.string()) }).passthrough().parse(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
            if (owned.paths.includes(entry.name)) continue;
          }
          const source = path.join(directory, entry.name);
          if (entry.isDirectory() && !fs.existsSync(path.join(source, "SKILL.md"))) continue;
          const content: FileSnapshot = entry.isDirectory() ? snapshot(source) : { kind: "directory", files: { "SKILL.md": { kind: "file", content: fs.readFileSync(source).toString("base64"), mode: 0o600 } }, mode: 0o755 };
          const fingerprint = snapshotHash(content);
          const canonicalId = cleanName(entry.isDirectory() ? entry.name : path.basename(entry.name, ".md"));
          const existing = skillNames.get(canonicalId);
          let reason: string | undefined;
          try { if (entry.isDirectory()) validateSkillPackage(source); else if (!/^---[\s\S]*?\nname:\s*[^\n]+[\s\S]*?\ndescription:\s*[^\n]+/m.test(fs.readFileSync(source, "utf8"))) throw new Error("Invalid skill"); } catch { reason = "Skill metadata is invalid; repair SKILL.md before adoption."; }
          const item: AdoptionItem = { id: sha256(`${installation.id}:skill:${source}`).slice(0, 24), harness: installation.id, kind: "skill", name: entry.name, path: source, nativeKey: entry.name, fingerprint: snapshotHash(snapshot(source)), canonicalId, action: reason ? "unsupported" : existing && existing !== fingerprint ? "conflict" : existing ? "reuse" : "import", reason: reason ?? (existing && existing !== fingerprint ? "A different skill uses this name." : undefined), reload: installation.reload };
          if (item.action === "import") skillNames.set(canonicalId, fingerprint);
          candidates.push({ item, installation, content });
        }
      }
      if (installation.harness === "claude" && installation.scope === "global") {
        const registryPath = path.join(process.env.HOME ?? os.homedir(), ".claude", "plugins", "installed_plugins.json");
        if (fs.existsSync(registryPath)) {
          const registry = z.object({ plugins: z.record(z.string(), z.array(z.object({ installPath: z.string() }).passthrough())) }).passthrough().parse(JSON.parse(fs.readFileSync(registryPath, "utf8")));
          const seen = new Set<string>();
          for (const [label, registrations] of Object.entries(registry.plugins)) for (const registration of registrations) {
            const source = path.resolve(registration.installPath.replace(/^~(?=\/)/, process.env.HOME ?? os.homedir()));
            if (seen.has(source) || !fs.existsSync(source) || fs.lstatSync(source).isSymbolicLink()) continue;
            seen.add(source);
            const content = snapshot(source);
            const fingerprint = snapshotHash(content);
            const name = cleanName(label.split("@")[0]);
            candidates.push(packageCandidate(config, installation, content, source, source, label, name, `claude:${label}`, "directory"));
          }
        }
      }
      // Pi's native package manager can load a managed local package without translation.
      if (installation.harness === "pi") {
        const settingsPath = path.join(path.dirname(installation.configPath!), "settings.json");
        if (fs.existsSync(settingsPath)) {
          const settings = z.object({ packages: z.array(z.union([z.string(), z.object({ source: z.string() }).passthrough()])).default([]) }).passthrough().parse(JSON.parse(fs.readFileSync(settingsPath, "utf8")));
          for (const [position, entry] of settings.packages.entries()) {
            const source = typeof entry === "string" ? entry : entry.source;
            if (/^(npm:|git:|https?:|ssh:)/.test(source)) {
              errors.push(`${installation.label}: remote or registry package source requires a resolved self-contained local source before adoption.`);
              continue;
            }
            let sourcePath = path.resolve(path.dirname(settingsPath), source.replace(/^~(?=\/)/, process.env.HOME ?? os.homedir()));
            if (!fs.existsSync(sourcePath)) continue;
            const managed = managedPackageAtLoadRoot(config, sourcePath);
            if (sourcePath.startsWith(path.join(getDataRoot(), "mcpx") + path.sep)) {
              if (!managed || !fs.existsSync(managed.source) || managed.source.startsWith(path.join(getDataRoot(), "mcpx") + path.sep)) continue;
              sourcePath = managed.source;
              if (snapshotHash(snapshot(sourcePath)) === managed.fingerprint) continue;
            }
            const content = snapshot(sourcePath);
            const fingerprint = snapshotHash(content);
            const name = cleanName(path.basename(sourcePath));
            const identity = packageIdentityBase(managed?.identity ?? `pi:${managed?.source ?? sourcePath}`);
            const scopedIdentity = installation.projectPath ? `${identity}:project:${sha256(path.resolve(installation.projectPath)).slice(0, 8)}` : identity;
            candidates.push(packageCandidate(config, installation, content, sourcePath, settingsPath, String(position), managed?.name ?? name, scopedIdentity, "settings"));
          }
        }
      }
    } catch { errors.push(`${installation.label}: configuration could not be read safely. Repair it before adopting.`); }
  }
  return { candidates, errors };
}

function packageSkills(candidate: Candidate, canonicalRoot: string): Skill[] {
  if (candidate.content?.kind !== "directory") return [];
  return Object.entries(candidate.content.files ?? {}).flatMap(([relative, file]) => {
    if (!relative.startsWith("skills/") || !relative.endsWith("/SKILL.md") || !file.content) return [];
    const content = Buffer.from(file.content, "base64").toString("utf8");
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return [];
    const metadata = z.object({ name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), description: z.string().min(1) }).passthrough().safeParse(YAML.parse(match[1]));
    if (!metadata.success) return [];
    return [{ id: `${candidate.item.name}__${metadata.data.name}`, content, root: path.join(canonicalRoot, path.dirname(relative)), projectionPath: `${candidate.item.name}/${metadata.data.name}`, scope: candidate.installation.projectPath, ownerHarness: candidate.installation.harness, source: "installed" as const, readOnly: true }];
  });
}

function projectNativePackage(candidate: Candidate, canonical: string, config: McpxConfig, secrets: SecretsManager): { projection: FileSnapshot | null; serverIds: string[] } {
  const source = candidate.content!;
  if (source.kind !== "directory") return { projection: null, serverIds: [] };
  const projection = structuredClone(source);
  let changed = false;
  const serverIds = new Set<string>();
  for (const filename of [".mcp.json", "mcp.json"]) {
    const file = source.files?.[filename];
    if (!file?.content) continue;
    const doc = z.record(z.string(), z.unknown()).parse(JSON.parse(Buffer.from(file.content, "base64").toString("utf8"))) as Record<string, any>;
    const servers = doc.mcpServers ?? doc;
    const projected: Record<string, unknown> = {};
    for (const [name, raw] of Object.entries(servers)) {
      const entry = z.object({ command: z.string().optional(), args: z.array(z.string()).optional(), env: z.record(z.string(), z.string()).optional(), cwd: z.string().optional(), url: z.string().optional(), headers: z.record(z.string(), z.string()).optional(), type: z.string().optional() }).passthrough().parse(raw);
      const resolve = (value: string) => value.replace(/\$\{(?:CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT)\}/g, canonical).replaceAll(candidate.sourceRoot!, canonical);
      if (!entry.url && !entry.command) throw new Error("Native package MCP definitions are unsupported; the source was preserved.");
      if (entry.type && !["http", "streamable-http", "stdio"].includes(entry.type)) throw new Error("Native package transport is unsupported; the source was preserved.");
      const scopeSuffix = candidate.installation.projectPath ? `__${sha256(path.resolve(candidate.installation.projectPath)).slice(0, 8)}` : "";
      const id = `${candidate.item.name.slice(0, 25)}__${cleanName(name).slice(0, 25)}${scopeSuffix}`;
      if (serverIds.has(id)) throw new Error("Native package MCP names collide after normalization; rename them.");
      serverIds.add(id);
      const spec: UpstreamServerSpec = entry.url ? { transport: "http", url: resolve(entry.url), headers: entry.headers } : { transport: "stdio", command: resolve(entry.command!), args: entry.args?.map(resolve), cwd: entry.cwd ? resolve(entry.cwd) : canonical, env: Object.fromEntries(Object.entries(entry.env ?? {}).map(([key, value]) => [key, resolve(value)])) };
      if (/\$\{/.test(JSON.stringify(spec))) throw new Error("Native package variables need explicit configuration; the source was preserved.");
      const scopedSpec: UpstreamServerSpec = { ...spec, ...(candidate.installation.projectPath ? { scope: candidate.installation.projectPath } : {}) };
      const owner = Object.values(config.packages ?? {}).find(pkg => pkg.servers?.includes(id));
      const existing = config.servers[id];
      const sameScope = existing?.scope === candidate.installation.projectPath;
      const equivalent = existing && sameScope && serverIdentity(existing, secrets) === serverIdentity(scopedSpec, secrets);
      if (existing && !equivalent && !packageOwnershipMatches(owner, candidate)) throw new Error("Native package MCP name conflicts with an existing integration.");
      config.servers[id] = protectServerSecrets(id, scopedSpec, secrets);
      projected[name] = { type: "http", url: `http://127.0.0.1:${config.gateway.port}/mcp?upstream=${encodeURIComponent(id)}`, headers: { Authorization: `Bearer ${consumerToken(config, candidate.installation.id, candidate.installation.projectPath, secrets)}` } };
    }
    projection.files![filename] = { ...file, content: Buffer.from(JSON.stringify(doc.mcpServers ? { ...doc, mcpServers: projected } : projected, null, 2)).toString("base64") };
    changed = true;
  }
  return { projection: changed ? projection : null, serverIds: [...serverIds] };
}

/** Discovery is read-only; plans contain metadata and hashes, never credentials. */
export function planAdoption(targets?: string[]): AdoptionPlan {
  const config = loadConfig();
  const result = scan(config, targets);
  return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), configHash: snapshotHash(snapshot(getConfigPath())), items: result.candidates.map(c => c.item), errors: result.errors };
}

export async function applyAdoption(rawPlan: AdoptionPlan, selectedIds?: string[], verify = verifyUpstreams) {
  const plan = adoptionPlanSchema.parse(rawPlan);
  const configBefore = snapshot(getConfigPath());
  if (snapshotHash(configBefore) !== plan.configHash) throw new Error("mcpx configuration changed. Scan again before adopting.");
  const managedIndexBefore = snapshot(getManagedIndexPath());
  const config = loadConfig();
  const initialServerSpecs = structuredClone(config.servers);
  const targets = [...new Set(plan.items.map(item => item.harness))];
  const rescanned = scan(config, targets);
  const selected = plan.items.filter(item => (!selectedIds || selectedIds.includes(item.id)) && ["import", "reuse"].includes(item.action));
  if (!selected.length) throw new Error("No supported integrations were selected.");
  const candidates = selected.map(item => {
    const current = rescanned.candidates.find(candidate => candidate.item.id === item.id);
    if (!current || JSON.stringify(itemSchema.parse(current.item)) !== JSON.stringify(item)) throw new Error("A native installation changed. Scan again before adopting.");
    return current;
  });
  const writes = new Map<string, PlannedWrite>();
  function addWrite(file: string, after: FileSnapshot) {
    const previous = writes.get(file);
    writes.set(file, { path: file, before: previous?.before ?? snapshot(file), after });
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mcpx-adopt-"));
  const index = loadManagedIndex();
  const secrets = new SecretsManager();
  const initialServers = new Set(Object.keys(config.servers));
  const stagedRoots = new Map<string, string>();
  try {
    const serversByHarness = new Map<string, Candidate[]>();
    const adoptedSkills: Skill[] = [];
    const packageSkillPrunes: Array<{ previous: Array<{ id: string; path: string; projectionPath: string }>; current: Skill[]; scope?: string; ownerHarness: string }> = [];
    for (const candidate of candidates) {
      const { item, installation } = candidate;
      if (candidate.server) {
        config.servers[item.canonicalId] ??= { ...protectServerSecrets(item.canonicalId, candidate.server.spec, secrets), ...(installation.projectPath ? { scope: installation.projectPath } : {}) };
        const list = serversByHarness.get(item.harness) ?? [];
        list.push(candidate);
        serversByHarness.set(item.harness, list);
      } else if (item.kind === "skill") {
        const canonical = path.join(getSkillPackagesRoot(), item.canonicalId);
        adoptedSkills.push({ id: item.canonicalId, content: Buffer.from(candidate.content!.files!["SKILL.md"].content!, "base64").toString("utf8"), root: canonical, scope: installation.projectPath });
        if (!writes.has(canonical) && !fs.existsSync(canonical)) addWrite(canonical, candidate.content!);
        const skillTarget = path.extname(item.path) === ".md" ? path.join(canonical, "SKILL.md") : canonical;
        addWrite(item.path, { kind: "link", content: path.relative(path.dirname(item.path), skillTarget) });
        const manifestPath = path.join(path.dirname(item.path), "mcpx-skills.json");
        const manifest = writes.has(manifestPath) ? JSON.parse(snapshotText(writes.get(manifestPath)!.after)) : fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : { version: 1, paths: [], hashes: {} };
        manifest.paths = [...new Set([...manifest.paths, path.basename(item.path)])];
        manifest.hashes ??= {};
        manifest.hashes[path.basename(item.path)] = sha256(`link:${path.relative(path.dirname(item.path), skillTarget)}`);
        addWrite(manifestPath, textSnapshot(JSON.stringify(manifest, null, 2) + "\n"));
      } else if (item.kind === "package") {
        const canonical = path.join(getDataRoot(), "mcpx", "packages", item.canonicalId, "revisions", snapshotHash(candidate.content!).slice(0, 16));
        if (!fs.existsSync(canonical)) addWrite(canonical, candidate.content!);
        else if (snapshotHash(snapshot(canonical)) !== snapshotHash(candidate.content!)) throw new Error("A managed package revision was modified locally. Preserve it before updating.");
        const stagedRoot = path.join(temp, item.canonicalId);
        writeSnapshot(stagedRoot, candidate.content!);
        stagedRoots.set(canonical, stagedRoot);
        const priorPackage = config.packages?.[item.canonicalId];
        const packageProjection = projectNativePackage(candidate, canonical, config, secrets);
        const projection = packageProjection.projection;
        const loadRoot = projection ? path.join(getDataRoot(), "mcpx", "packages", "projections", item.canonicalId, snapshotHash(candidate.content!).slice(0, 16)) : canonical;
        if (projection) addWrite(loadRoot, projection);
        let sourceLabel = candidate.sourceRoot!;
        if (candidate.packageMode === "directory") {
          addWrite(item.path, { kind: "link", content: path.relative(path.dirname(item.path), loadRoot) });
        } else {
          const settings = JSON.parse(writes.has(item.path) ? snapshotText(writes.get(item.path)!.after) : fs.readFileSync(item.path, "utf8"));
          const entry = settings.packages[Number(item.nativeKey)];
          settings.packages[Number(item.nativeKey)] = typeof entry === "string" ? loadRoot : { ...entry, source: loadRoot };
          addWrite(item.path, textSnapshot(JSON.stringify(settings, null, 2) + "\n"));
        }
        const skills = packageSkills(candidate, canonical);
        adoptedSkills.push(...skills);
        const ownsPriorPackage = packageOwnershipMatches(priorPackage, candidate);
        if (ownsPriorPackage) packageSkillPrunes.push({ previous: priorPackage!.skills ?? [], current: skills, scope: priorPackage!.scope, ownerHarness: priorPackage!.harness });
        const ownedServers = ownsPriorPackage ? priorPackage!.servers ?? [] : [];
        const currentServers = new Set(packageProjection.serverIds);
        for (const serverName of ownedServers) {
          if (currentServers.has(serverName) || !config.servers[serverName]) continue;
          const alsoOwned = Object.entries(config.packages ?? {}).some(([id, pkg]) => id !== item.canonicalId && pkg.servers?.includes(serverName));
          if (alsoOwned) continue;
          delete config.servers[serverName];
          for (const project of Object.values(config.projects ?? {})) {
            if (project.disabledServers) project.disabledServers = project.disabledServers.filter(name => name !== serverName);
          }
        }
        config.packages ??= {};
        config.packages[item.canonicalId] = { id: item.canonicalId, root: canonical, source: sourceLabel, harness: installation.harness, fingerprint: snapshotHash(candidate.content!), pinned: priorPackage?.pinned ?? false, name: item.name, identity: candidate.packageIdentity, scope: installation.projectPath, skills: skills.map(skill => ({ id: skill.id, path: path.relative(canonical, skill.root!), projectionPath: skill.projectionPath! })), servers: packageProjection.serverIds, ...(priorPackage && priorPackage.fingerprint !== snapshotHash(candidate.content!) ? { previous: { root: priorPackage.root, fingerprint: priorPackage.fingerprint } } : {}) };
      }
      config.origins ??= {};
      config.origins[item.id] = { id: item.canonicalId, kind: item.kind, harness: item.harness, source: item.path, nativeKey: item.nativeKey, fingerprint: item.fingerprint, operationId: plan.id };
      config.harnesses ??= {};
      config.harnesses[installation.id] ??= { mode: "selected" };
    }
    // Deliver newly adopted capabilities to opted-in, detected installations in
    // the same recoverable operation, so undo includes every generated entry.
    const installations = installationAdapters(config);
    const serverNames = new Set([...Object.keys(initialServerSpecs), ...Object.keys(config.servers)]);
    const serverStateChanged = [...serverNames].some(name => JSON.stringify(initialServerSpecs[name]) !== JSON.stringify(config.servers[name]));
    if (serverStateChanged) {
      for (const { installation } of installations) if (installation.mode !== "observe" && installation.detected && installation.configPath && !serversByHarness.has(installation.id)) serversByHarness.set(installation.id, []);
    }
    for (const update of packageSkillPrunes) {
      for (const { installation, adapter } of installations) {
        if (installation.mode === "observe" || !installation.detected || !installation.skillPaths[0]) continue;
        if (update.scope && update.scope !== installation.projectPath) continue;
        if (update.ownerHarness === installation.harness) continue;
        const flat = adapter.descriptor?.skillLayout === "flat";
        const wanted = new Set(update.current.map(skill => flat ? `${skill.id}.md` : skill.projectionPath ?? skill.id));
        const directory = path.resolve(installation.skillPaths[0]);
        const manifestPath = path.join(directory, "mcpx-skills.json");
        for (const previous of update.previous) {
          const relative = flat ? `${previous.id}.md` : previous.projectionPath ?? previous.id;
          if (wanted.has(relative)) continue;
          const target = path.resolve(directory, relative);
          if (target === directory || !target.startsWith(directory + path.sep)) continue;
          const manifestState = writes.has(manifestPath) ? writes.get(manifestPath)!.after : snapshot(manifestPath);
          if (manifestState.kind !== "file") continue;
          let manifestValue: unknown;
          try { manifestValue = JSON.parse(snapshotText(manifestState)); } catch { continue; }
          const parsed = z.object({ version: z.literal(1), paths: z.array(z.string()), hashes: z.record(z.string(), z.string()).default({}) }).passthrough().safeParse(manifestValue);
          if (!parsed.success || !parsed.data.paths.includes(relative) || !parsed.data.hashes[relative]) continue;
          if (snapshot(target).kind !== "link" || pathFingerprint(target) !== parsed.data.hashes[relative]) continue;
          addWrite(target, { kind: "missing" });
          parsed.data.paths = parsed.data.paths.filter(item => item !== relative);
          delete parsed.data.hashes[relative];
          addWrite(manifestPath, textSnapshot(JSON.stringify(parsed.data, null, 2) + "\n"));
        }
      }
    }
    for (const skill of adoptedSkills) {
      const canonical = skill.root!;
      for (const { installation, adapter } of installations) {
        if (installation.mode === "observe" || !installation.detected || !installation.skillPaths[0]) continue;
        if (skill.scope && skill.scope !== installation.projectPath) continue;
        if (skill.ownerHarness === installation.harness) continue;
        if (candidates.some(candidate => candidate.item.kind === "skill" && candidate.item.canonicalId === skill.id && adapter.additionalSkillDirectories?.().some(dir => candidate.item.path.startsWith(dir + path.sep)))) continue;
        const flat = adapter.descriptor?.skillLayout === "flat";
        const relative = flat ? `${skill.id}.md` : skill.projectionPath ?? skill.id;
        const target = path.join(installation.skillPaths[0], relative);
        if (writes.has(target)) continue;
        const manifestPath = path.join(installation.skillPaths[0], "mcpx-skills.json");
        const manifest = writes.has(manifestPath) ? JSON.parse(snapshotText(writes.get(manifestPath)!.after)) : fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : { version: 1, paths: [], hashes: {} };
        const current = snapshot(target);
        if (current.kind !== "missing" && (!manifest.paths.includes(relative) || manifest.hashes?.[relative] !== pathFingerprint(target))) continue;
        const destination = flat ? path.join(canonical, "SKILL.md") : canonical;
        const link = path.relative(path.dirname(target), destination);
        addWrite(target, { kind: "link", content: link });
        manifest.paths = [...new Set([...manifest.paths, relative])];
        manifest.hashes ??= {}; manifest.hashes[relative] = sha256(`link:${link}`);
        addWrite(manifestPath, textSnapshot(JSON.stringify(manifest, null, 2) + "\n"));
      }
    }
    // Build native replacements in a private staging directory. Legacy adapters
    // remain codecs; no native entry is removed until all write intents are durable.
    for (const [harness, entries] of serversByHarness) {
      const original = installationAdapters(config).find(item => item.installation.id === harness)!;
      const source = original.installation.configPath!;
      const stagePath = path.join(temp, sha256(harness) + path.extname(source));
      if (fs.existsSync(source)) fs.copyFileSync(source, stagePath);
      const staged = Object.create(original.adapter);
      staged.detectConfigPath = () => stagePath;
      const token = consumerToken(config, harness, original.installation.projectPath, secrets);
      const result = staged.syncGateway(config, { managedIndex: index, managedIndexPath: getManagedIndexPath(), sourceEntriesToRemove: entries.map(entry => entry.item.nativeKey), managedEntries: Object.entries(config.servers).filter(([, spec]) => !spec.scope || spec.scope === original.installation.projectPath).map(([name, spec]) => ({ name: `${name} (mcpx)`, url: `http://127.0.0.1:${config.gateway.port}/mcp?upstream=${encodeURIComponent(name)}`, headers: { Authorization: `Bearer ${token}` }, enabled: spec.enabled !== false })) });
      if (result.status !== "SYNCED") throw new Error(result.message ?? "Native projection failed.");
      const stagedDoc = readNativeDocument(stagePath);
      const stagedServers = nativeServers(original.installation.harness, stagedDoc);
      const nativeDoc = readNativeDocument(source);
      const sourceServers = nativeServers(original.installation.harness, nativeDoc);
      for (const entry of entries) {
        const managedName = original.adapter.managedName?.(entry.item.canonicalId) ?? `${entry.item.canonicalId} (mcpx)`;
        if (!stagedServers[managedName]) continue;
        const nativeEntry = sourceServers[entry.item.nativeKey] ?? {};
        for (const key of ["exposure", "toolExposure", "timeout", "description", "alwaysAllow", "disabledTools", "autoApprove"]) if (key in nativeEntry) stagedServers[managedName][key] = nativeEntry[key];
        index.managed[harness].entries[managedName].fingerprint = sha256(JSON.stringify(stagedServers[managedName]));
      }
      writeNativeDocument(stagePath, stagedDoc);
      index.managed[harness].configPath = source;
      addWrite(source, snapshot(stagePath));
      config.clients[harness] = { status: "SYNCED", configPath: source, lastSyncAt: new Date().toISOString(), message: original.installation.reload };
    }
    config.revision = (config.revision ?? 0) + 1;
    const verificationConfig = structuredClone(config);
    for (const [name, spec] of Object.entries(verificationConfig.servers)) {
      let serialized = JSON.stringify(spec);
      for (const [canonical, staged] of stagedRoots) serialized = serialized.replaceAll(canonical, staged);
      verificationConfig.servers[name] = JSON.parse(serialized);
    }
    await verify(verificationConfig, [...Object.keys(config.servers).filter(name => !initialServers.has(name)), ...candidates.filter(candidate => candidate.server).map(candidate => candidate.item.canonicalId)]);
    // Canonical artifacts and config are committed before native cutover.
    const canonical = Array.from(writes.values()).filter(write => write.path.startsWith(path.join(getDataRoot(), "mcpx") + path.sep));
    const native = Array.from(writes.values()).filter(write => !canonical.includes(write));
    return applyWrites("Adopt native integrations", [...canonical, { path: getConfigPath(), before: configBefore, after: textSnapshot(JSON.stringify(config, null, 2) + "\n") }, { path: getManagedIndexPath(), before: managedIndexBefore, after: textSnapshot(JSON.stringify(index, null, 2) + "\n") }, ...native], plan.id, selected.map(item => `${item.kind} · ${item.name} · ${item.harness}`));
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
