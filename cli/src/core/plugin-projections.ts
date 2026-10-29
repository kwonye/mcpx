import fs from "node:fs";
import { getAdapters } from "../adapters/index.js";
import { z } from "zod";
import { writeJsonAtomic } from "../util/fs.js";
import { pathFingerprint } from "./file-state.js";
import path from "node:path";
import { homeDir, ensureDir } from "./paths.js";
import { normalizePluginName } from "./identifiers.js";
import { parseAgentSkill, validateAgentSkillDirectory } from "./agent-skills.js";
import type { PluginSyncInput, PluginSyncResult } from "../types.js";

const OWNERSHIP_MANIFEST = "mcpx-plugins.json";

interface OwnershipManifest {
  version: 1;
  plugins: Record<string, {
    pluginId: string;
    paths: string[];
    installedAt: string;
    hashes?: Record<string, string>;
  }>;
}

function loadOwnership(targetDir: string): OwnershipManifest {
  const manifestPath = path.join(targetDir, OWNERSHIP_MANIFEST);
  if (!fs.existsSync(manifestPath)) {
    return { version: 1, plugins: {} };
  }
  try {
    return z.object({ version: z.literal(1), plugins: z.record(z.string(), z.object({ pluginId: z.string(), paths: z.array(z.string()), installedAt: z.string(), hashes: z.record(z.string(), z.string()).optional() })) }).parse(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  } catch {
    console.error(`[mcpx] Warning: corrupt plugin ownership manifest at ${manifestPath}, resetting`);
    throw new Error(`Invalid plugin ownership manifest: ${manifestPath}`);
  }
}

function saveOwnership(targetDir: string, manifest: OwnershipManifest): void {
  writeJsonAtomic(path.join(targetDir, OWNERSHIP_MANIFEST), manifest);
}

function recordOwned(targetDir: string, pluginId: string, paths: string[]): void {
  const manifest = loadOwnership(targetDir);
  const previous = manifest.plugins[pluginId]?.paths ?? [];
  const next = new Set(paths);
  for (const stale of previous) {
    if (next.has(stale)) continue;
    const stalePath = path.join(targetDir, stale);
    try {
      assertWithinBase(targetDir, stalePath);
      if (manifest.plugins[pluginId]?.hashes?.[stale] === pathFingerprint(stalePath)) fs.rmSync(stalePath, { recursive: true, force: true });
    } catch {
      // Never remove a path outside the projection base.
    }
  }
  manifest.plugins[pluginId] = {
    pluginId,
    paths,
    installedAt: new Date().toISOString(),
    hashes: Object.fromEntries(paths.map(p => [p, pathFingerprint(path.join(targetDir, p)) ?? ""])),
  };
  saveOwnership(targetDir, manifest);
}

function removeOwned(targetDir: string, pluginId: string): string[] {
  const manifest = loadOwnership(targetDir);
  const entry = manifest.plugins[pluginId];
  if (entry) {
    delete manifest.plugins[pluginId];
    saveOwnership(targetDir, manifest);
    return entry.paths;
  }
  return [];
}

export function prunePluginProjections(targetDir: string, pluginId: string): void {
  const entry = loadOwnership(targetDir).plugins[pluginId];
  const paths = removeOwned(targetDir, pluginId);
  for (const p of paths) {
    const fullPath = path.join(targetDir, p);
    try {
      assertWithinBase(targetDir, fullPath);
      if (entry?.hashes?.[p] && entry.hashes[p] === pathFingerprint(fullPath)) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  }
}

export function pruneAllPluginProjections(targetDir: string): void {
  const manifest = loadOwnership(targetDir);
  for (const [pluginId] of Object.entries(manifest.plugins)) {
    prunePluginProjections(targetDir, pluginId);
  }
}

/**
 * Prune every plugin from the ownership manifest that is NOT in the keep list.
 */
export function pruneUnlistedPlugins(targetDir: string, keepPluginIds: string[]): void {
  const manifest = loadOwnership(targetDir);
  const keep = new Set(keepPluginIds);
  for (const [pluginId] of Object.entries(manifest.plugins)) {
    if (!keep.has(pluginId)) {
      prunePluginProjections(targetDir, pluginId);
    }
  }
}

function assertWithinBase(base: string, target: string): void {
  if (!path.resolve(target).startsWith(path.resolve(base) + path.sep)) throw new Error("Invalid skill projection path");
}

export function syncProjectPluginSkills(clientId: string, skillsBase: string, plugins: PluginSyncInput[]): PluginSyncResult {
  const projectedDirs: string[] = [];
  const errors: string[] = [];
  pruneUnlistedPlugins(skillsBase, plugins.filter(plugin => plugin.enabled).map(plugin => plugin.pluginId));
  for (const plugin of plugins) {
    const owned: string[] = [];
    if (plugin.enabled && plugin.components.skills && plugin.approvals?.skills !== false) for (const skill of plugin.skills) {
      try {
        const root = path.basename(skill.path) === "SKILL.md" ? path.dirname(skill.path) : skill.path;
        const metadata = parseAgentSkill(fs.readFileSync(path.join(root, "SKILL.md"), "utf8"), path.basename(root));
        validateAgentSkillDirectory(root, metadata.name);
        const relative = path.join(normalizePluginName(plugin.pluginName), metadata.name);
        const target = path.join(skillsBase, relative);
        assertWithinBase(skillsBase, target);
        const current = pathFingerprint(target);
        const prior = loadOwnership(skillsBase).plugins[plugin.pluginId];
        if (current !== null && (!prior?.paths.includes(relative) || prior.hashes?.[relative] !== current)) throw new Error(`Preserving local skill: ${relative}`);
        if (current !== null) fs.rmSync(target, { recursive: true, force: true });
        ensureDir(path.dirname(target));
        fs.cpSync(root, target, { recursive: true, dereference: true });
        owned.push(relative);
        projectedDirs.push(target);
      } catch (error) { errors.push(`${plugin.pluginName}/${skill.id}: ${(error as Error).message}`); }
    }
    // Keep receipts for conflicts, so later syncs cannot claim edited files.
    const prior = loadOwnership(skillsBase).plugins[plugin.pluginId];
    for (const relative of prior?.paths ?? []) if (!owned.includes(relative) && pathFingerprint(path.join(skillsBase, relative)) !== null && prior?.hashes?.[relative] !== pathFingerprint(path.join(skillsBase, relative))) owned.push(relative);
    if (fs.existsSync(skillsBase)) {
      const retained = Object.fromEntries((prior?.paths ?? []).filter(relative => owned.includes(relative) && !projectedDirs.includes(path.join(skillsBase, relative))).map(relative => [relative, prior?.hashes?.[relative] ?? ""]));
      recordOwned(skillsBase, plugin.pluginId, owned);
      if (Object.keys(retained).length) {
        const manifest = loadOwnership(skillsBase);
        Object.assign(manifest.plugins[plugin.pluginId].hashes!, retained);
        saveOwnership(skillsBase, manifest);
      }
    }
  }
  return { clientId, status: errors.length ? "ERROR" : "SYNCED", projectedDirs, unsupported: ["hooks", "agents", "commands"], ...(errors.length ? { error: errors.join("; ") } : {}) };
}

export function syncPluginsToClient(clientId: string, plugins: PluginSyncInput[]): PluginSyncResult {
  const adapter = getAdapters().find(adapter => adapter.id === clientId);
  const base = adapter?.skillDirectory?.() ?? (adapter?.descriptor?.skillPath ? path.join(homeDir(), adapter.descriptor.skillPath) : undefined);
  if (!base) return { clientId, status: "SKIPPED", projectedDirs: [], unsupported: ["skills", "hooks", "agents", "commands"] };
  return syncProjectPluginSkills(clientId, base, plugins);
}
