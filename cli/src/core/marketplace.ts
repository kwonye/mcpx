import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import type {
  ManagedMarketplace,
  MarketplaceFormat,
  MarketplaceListing,
  MarketplacePluginDetail,
  McpxConfig,
  PluginComponent,
  PluginSource,
} from "../types.js";
import { getMarketplaceCacheRoot, ensureDir } from "./paths.js";
import { loadConfig } from "./config.js";
import { mutateConfig } from "./config-store.js";
import { PluginCache } from "./plugin-cache.js";
import { discoverComponents, hasManifest, readManifest } from "./plugin-parse.js";
import { PluginManager, uninstallPlugin } from "./plugin-manager.js";

const CLAUDE_MANIFEST = ".claude-plugin/marketplace.json";
const CODEX_MANIFEST = ".agents/plugins/marketplace.json";
const SUPPORTED = new Set(["skills", "commands", "agents", "hooks", "mcpServers"]);
const UNSUPPORTED = new Set(["apps", "lspServers", "settings", "outputStyles", "dependencies"]);

const authorSchema = z.object({
  name: z.string(),
  email: z.string().optional(),
  url: z.string().optional(),
}).passthrough();

const claudeEntrySchema = z.object({
  name: z.string().min(1),
  displayName: z.string().optional(),
  description: z.string().optional(),
  version: z.string().optional(),
  author: authorSchema.optional(),
  homepage: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  source: z.unknown(),
  skills: z.unknown().optional(),
  commands: z.unknown().optional(),
  agents: z.unknown().optional(),
  hooks: z.unknown().optional(),
  mcpServers: z.unknown().optional(),
  lspServers: z.unknown().optional(),
  apps: z.unknown().optional(),
  settings: z.unknown().optional(),
  outputStyles: z.unknown().optional(),
  dependencies: z.unknown().optional(),
}).passthrough();

const claudeCatalogSchema = z.object({
  name: z.string().min(1),
  owner: authorSchema,
  plugins: z.array(claudeEntrySchema),
}).passthrough();

const codexEntrySchema = z.object({
  name: z.string().min(1),
  source: z.unknown(),
  category: z.string().optional(),
  policy: z.object({
    installation: z.string().optional(),
    authentication: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

const codexCatalogSchema = z.object({
  name: z.string().min(1),
  interface: z.object({ displayName: z.string().optional() }).passthrough().optional(),
  plugins: z.array(codexEntrySchema),
}).passthrough();

type RawEntry = z.infer<typeof claudeEntrySchema> | z.infer<typeof codexEntrySchema>;

interface LoadedCatalog {
  name: string;
  displayName: string;
  format: MarketplaceFormat;
  entries: RawEntry[];
  root: string;
  manifestPath: string;
}

function sourceKey(source: string): string {
  return crypto.createHash("sha256").update(source).digest("hex").slice(0, 20);
}

function snapshotRoot(source: string, revision: string): string {
  return path.join(getMarketplaceCacheRoot(), sourceKey(source), revision);
}

function copyDirectory(source: string, destination: string): void {
  fs.cpSync(source, destination, { recursive: true, dereference: false });
}

function hashPath(target: string): string {
  const hash = crypto.createHash("sha256");
  const visit = (current: string, relative: string): void => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      hash.update(relative).update(fs.readlinkSync(current));
      return;
    }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current).sort()) {
        if (name === ".git" || name === ".DS_Store") continue;
        visit(path.join(current, name), path.join(relative, name));
      }
      return;
    }
    hash.update(relative).update(fs.readFileSync(current));
  };
  visit(target, "");
  return hash.digest("hex");
}

function parseGitSource(source: string): { remote: string; ref: string } | null {
  const hashIndex = source.lastIndexOf("#");
  const withoutRef = hashIndex > source.indexOf("//") ? source.slice(0, hashIndex) : source;
  const ref = hashIndex > source.indexOf("//") ? source.slice(hashIndex + 1) : "HEAD";
  if (/^[\w.-]+\/[\w.-]+$/.test(withoutRef)) {
    return { remote: `https://github.com/${withoutRef}.git`, ref };
  }
  if (/^(?:https?:\/\/|ssh:\/\/|git@).+/.test(withoutRef) && !withoutRef.endsWith(".json")) {
    return { remote: withoutRef, ref };
  }
  return null;
}

function marketplaceSourceType(source: string): ManagedMarketplace["sourceType"] {
  if (/^[\w.-]+\/[\w.-]+(?:#.+)?$/.test(source)) return "github";
  if (/^https?:\/\/.+\.json(?:[?#].*)?$/.test(source)) return "hosted-json";
  if (/^(?:https?:\/\/|ssh:\/\/|git@)/.test(source)) return "git";
  return "local";
}

async function acquireSource(source: string): Promise<{ root: string; revision: string }> {
  ensureDir(getMarketplaceCacheRoot());
  const git = parseGitSource(source);
  if (git) {
    const revision = execFileSync("git", ["ls-remote", git.remote, git.ref], { encoding: "utf8", timeout: 30000 })
      .split("\t")[0]?.trim();
    if (!revision) throw new Error(`Could not resolve ${git.ref} for ${source}`);
    const destination = snapshotRoot(source, revision);
    if (fs.existsSync(destination)) return { root: destination, revision };
    ensureDir(path.dirname(destination));
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mcpx-marketplace-"));
    try {
      execFileSync("git", ["init"], { cwd: temp, stdio: "pipe", timeout: 10000 });
      execFileSync("git", ["remote", "add", "origin", git.remote], { cwd: temp, stdio: "pipe", timeout: 10000 });
      execFileSync("git", ["fetch", "--depth", "1", "origin", revision], { cwd: temp, stdio: "pipe", timeout: 60000 });
      execFileSync("git", ["checkout", "--detach", "FETCH_HEAD"], { cwd: temp, stdio: "pipe", timeout: 10000 });
      fs.rmSync(path.join(temp, ".git"), { recursive: true, force: true });
      fs.renameSync(temp, destination);
    } catch (error) {
      fs.rmSync(temp, { recursive: true, force: true });
      throw error;
    }
    return { root: destination, revision };
  }

  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Marketplace request failed (${response.status})`);
    const body = await response.text();
    const revision = crypto.createHash("sha256").update(body).digest("hex");
    const destination = snapshotRoot(source, revision);
    if (!fs.existsSync(destination)) {
      ensureDir(destination);
      fs.writeFileSync(path.join(destination, "marketplace.json"), body, { mode: 0o600 });
    }
    return { root: destination, revision };
  }

  const resolved = path.resolve(source);
  if (!fs.existsSync(resolved)) throw new Error(`Marketplace path not found: ${resolved}`);
  const sourceRoot = fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
  const revision = hashPath(resolved);
  const destination = snapshotRoot(source, revision);
  if (!fs.existsSync(destination)) {
    ensureDir(path.dirname(destination));
    copyDirectory(sourceRoot, destination);
  }
  return { root: destination, revision };
}

function locateManifest(root: string, requested?: string): string {
  const candidates = requested
    ? [requested]
    : [CLAUDE_MANIFEST, CODEX_MANIFEST, "marketplace.json"];
  for (const candidate of candidates) {
    const resolved = path.resolve(root, candidate);
    if ((resolved === root || resolved.startsWith(path.resolve(root) + path.sep)) && fs.existsSync(resolved)) {
      return resolved;
    }
  }
  throw new Error(`Marketplace manifest not found. Expected ${candidates.join(" or ")}.`);
}

function loadCatalog(root: string, requested?: string, expectedFormat?: MarketplaceFormat): LoadedCatalog {
  const manifest = locateManifest(root, requested);
  const raw = JSON.parse(fs.readFileSync(manifest, "utf8"));
  const format: MarketplaceFormat = expectedFormat
    ?? (manifest.includes(`${path.sep}.agents${path.sep}`) || raw.interface ? "codex" : "claude");
  if (format === "codex") {
    const parsed = codexCatalogSchema.parse(raw);
    return {
      name: parsed.name,
      displayName: parsed.interface?.displayName ?? parsed.name,
      format,
      entries: parsed.plugins,
      root,
      manifestPath: path.relative(root, manifest),
    };
  }
  const parsed = claudeCatalogSchema.parse(raw);
  return { name: parsed.name, displayName: parsed.name, format, entries: parsed.plugins, root, manifestPath: path.relative(root, manifest) };
}

function marketplaceSnapshot(marketplace: ManagedMarketplace): LoadedCatalog {
  if (!marketplace.resolvedRevision) throw new Error(`Marketplace ${marketplace.name} has not been downloaded yet`);
  const root = snapshotRoot(marketplace.source, marketplace.resolvedRevision);
  if (!fs.existsSync(root)) throw new Error(`Cached marketplace snapshot is missing for ${marketplace.name}`);
  return loadCatalog(root, marketplace.manifestPath, marketplace.format);
}

function resolveContained(root: string, relative: string): string {
  const resolved = path.resolve(root, relative);
  const realRoot = fs.realpathSync(root);
  if (!fs.existsSync(resolved)) throw new Error(`Marketplace plugin path not found: ${relative}`);
  const realResolved = fs.realpathSync(resolved);
  if (realResolved !== realRoot && !realResolved.startsWith(realRoot + path.sep)) {
    throw new Error(`Marketplace plugin path escapes its snapshot: ${relative}`);
  }
  return realResolved;
}

export function resolveMarketplacePluginSource(catalog: LoadedCatalog, entry: RawEntry): PluginSource {
  const value = entry.source;
  if (typeof value === "string") {
    if (!value.startsWith("./")) throw new Error(`Unsupported marketplace plugin source: ${value}`);
    return { type: "local", original: resolveContained(catalog.root, value) };
  }
  const source = z.object({
    source: z.string(),
    repo: z.string().optional(),
    url: z.string().optional(),
    path: z.string().optional(),
    ref: z.string().optional(),
    sha: z.string().optional(),
    package: z.string().optional(),
  }).passthrough().parse(value);
  if (source.source === "local") {
    if (!source.path) throw new Error("Local marketplace plugin source is missing path");
    return { type: "local", original: resolveContained(catalog.root, source.path) };
  }
  if (source.source === "github") {
    if (!source.repo) throw new Error("GitHub plugin source is missing repo");
    return { type: "github", original: source.repo, ref: source.ref, resolvedSha: source.sha };
  }
  if (source.source === "url") {
    if (!source.url) throw new Error("Git plugin source is missing URL");
    return { type: "git", original: source.url, ref: source.ref, resolvedSha: source.sha };
  }
  if (source.source === "git-subdir") {
    if (!source.url || !source.path) throw new Error("git-subdir plugin source is missing URL or path");
    return { type: "git-subdir", original: source.url, path: source.path, ref: source.ref, resolvedSha: source.sha };
  }
  if (source.source === "npm") {
    return { type: "npm", original: `npm:${source.package ?? entry.name}` };
  }
  throw new Error(`Unsupported marketplace plugin source type: ${source.source}`);
}

function findPluginRoot(root: string): string {
  if (hasManifest(root)) return root;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && hasManifest(path.join(root, entry.name))) return path.join(root, entry.name);
  }
  return root;
}

function capabilities(root: string | null, entry: RawEntry): { supported: string[]; unsupported: string[] } {
  const supported = new Set<string>();
  const unsupported = new Set<string>();
  for (const key of [...SUPPORTED, ...UNSUPPORTED]) {
    if ((entry as Record<string, unknown>)[key] !== undefined) (SUPPORTED.has(key) ? supported : unsupported).add(key);
  }
  const sourceObject = typeof entry.source === "object" && entry.source ? entry.source as Record<string, unknown> : null;
  if (sourceObject?.source === "npm") unsupported.add("npm");
  if (root) {
    const manifest = readManifest(root);
    for (const key of manifest?.declaredCapabilities ?? []) (SUPPORTED.has(key) ? supported : unsupported).add(key);
    const discovered = discoverComponents(root);
    if (discovered.skills.length) supported.add("skills");
    if (discovered.commands.length) supported.add("commands");
    if (discovered.agents.length) supported.add("agents");
    if (discovered.hooks.length) supported.add("hooks");
    if (discovered.mcpServers.length) supported.add("mcpServers");
  }
  return { supported: [...supported].sort(), unsupported: [...unsupported].sort() };
}

function relativePluginRoot(catalog: LoadedCatalog, entry: RawEntry): string | null {
  try {
    const source = resolveMarketplacePluginSource(catalog, entry);
    return source.type === "local" ? findPluginRoot(source.original) : null;
  } catch {
    return null;
  }
}

function listingFromEntry(config: McpxConfig, marketplace: ManagedMarketplace, catalog: LoadedCatalog, entry: RawEntry): MarketplaceListing {
  const root = relativePluginRoot(catalog, entry);
  const manifest = root ? readManifest(root) : null;
  const caps = capabilities(root, entry);
  const raw = entry as Record<string, any>;
  const installationAvailable = raw.policy?.installation === undefined || raw.policy.installation === "AVAILABLE";
  return {
    id: `${entry.name}@${marketplace.name}`,
    name: entry.name,
    displayName: raw.displayName ?? manifest?.displayName ?? entry.name,
    marketplace: marketplace.name,
    description: raw.description ?? manifest?.description,
    author: raw.author ?? manifest?.author,
    homepage: raw.homepage ?? manifest?.homepage,
    version: raw.version ?? manifest?.version,
    category: raw.category ?? manifest?.category,
    tags: [...(raw.tags ?? []), ...(raw.keywords ?? manifest?.keywords ?? [])],
    source: entry.source,
    supportedCapabilities: caps.supported,
    unsupportedCapabilities: caps.unsupported,
    compatible: installationAvailable && (caps.supported.length > 0 || (!root && caps.unsupported.length === 0)),
    installed: Object.values(config.plugins ?? {}).some((plugin) => plugin.marketplace?.name === marketplace.name && plugin.marketplace.pluginName === entry.name),
    authentication: raw.policy?.authentication,
  };
}

function parseQualified(id: string): { pluginName: string; marketplaceName: string } {
  const at = id.lastIndexOf("@");
  if (at <= 0 || at === id.length - 1) throw new Error(`Expected plugin@marketplace, received "${id}"`);
  return { pluginName: id.slice(0, at), marketplaceName: id.slice(at + 1) };
}

async function ensureReady(marketplace: ManagedMarketplace): Promise<ManagedMarketplace> {
  if (marketplace.resolvedRevision) return marketplace;
  if (process.env.MCPX_NO_UPDATE === "1") return marketplace;
  try {
    return await refreshMarketplace(marketplace.name);
  } catch {
    return loadConfig().marketplaces?.[marketplace.name] ?? marketplace;
  }
}

export async function listMarketplaces(): Promise<ManagedMarketplace[]> {
  return Object.values(loadConfig().marketplaces ?? {}).sort((a, b) => Number(b.builtIn) - Number(a.builtIn) || a.displayName.localeCompare(b.displayName));
}

export async function addMarketplace(source: string, manifestPath?: string): Promise<ManagedMarketplace> {
  const acquired = await acquireSource(source);
  const catalog = loadCatalog(acquired.root, manifestPath);
  const config = loadConfig();
  const existing = config.marketplaces?.[catalog.name];
  if (existing?.builtIn) throw new Error(`Built-in marketplace ${catalog.name} cannot be replaced`);
  const now = new Date().toISOString();
  const marketplace: ManagedMarketplace = {
    name: catalog.name,
    displayName: catalog.displayName,
    source,
    sourceType: marketplaceSourceType(source),
    manifestPath: catalog.manifestPath,
    format: catalog.format,
    builtIn: false,
    autoUpdate: false,
    addedAt: existing?.addedAt ?? now,
    lastCheckedAt: now,
    lastUpdatedAt: now,
    resolvedRevision: acquired.revision,
    status: "ready",
  };
  await mutateConfig((fresh) => {
    if (!fresh.marketplaces) fresh.marketplaces = {};
    if (fresh.marketplaces[catalog.name]?.builtIn) throw new Error(`Built-in marketplace ${catalog.name} cannot be replaced`);
    fresh.marketplaces[catalog.name] = marketplace;
  });
  return marketplace;
}

export async function refreshMarketplace(name: string): Promise<ManagedMarketplace> {
  const current = loadConfig().marketplaces?.[name];
  if (!current) throw new Error(`Marketplace ${name} not found`);
  const checkedAt = new Date().toISOString();
  try {
    const acquired = await acquireSource(current.source);
    const catalog = loadCatalog(acquired.root, current.manifestPath, current.format);
    if (catalog.name !== current.name) throw new Error(`Marketplace name changed from ${current.name} to ${catalog.name}`);
    let updated!: ManagedMarketplace;
    await mutateConfig((config) => {
      const fresh = config.marketplaces?.[name];
      if (!fresh) throw new Error(`Marketplace ${name} not found`);
      fresh.displayName = catalog.displayName;
      fresh.manifestPath = catalog.manifestPath;
      fresh.format = catalog.format;
      fresh.lastCheckedAt = checkedAt;
      fresh.lastUpdatedAt = acquired.revision === fresh.resolvedRevision ? fresh.lastUpdatedAt : checkedAt;
      fresh.resolvedRevision = acquired.revision;
      fresh.status = "ready";
      delete fresh.error;
      updated = { ...fresh };
    });
    return updated;
  } catch (error) {
    await mutateConfig((config) => {
      const fresh = config.marketplaces?.[name];
      if (!fresh) return;
      fresh.lastCheckedAt = checkedAt;
      fresh.status = fresh.resolvedRevision ? "stale" : "error";
      fresh.error = error instanceof Error ? error.message : String(error);
    });
    throw error;
  }
}

export async function setMarketplaceAutoUpdate(name: string, enabled: boolean): Promise<ManagedMarketplace> {
  let updated!: ManagedMarketplace;
  await mutateConfig((config) => {
    const marketplace = config.marketplaces?.[name];
    if (!marketplace) throw new Error(`Marketplace ${name} not found`);
    marketplace.autoUpdate = enabled;
    updated = { ...marketplace };
  });
  return updated;
}

export async function removeMarketplace(name: string): Promise<void> {
  const config = loadConfig();
  const marketplace = config.marketplaces?.[name];
  if (!marketplace) throw new Error(`Marketplace ${name} not found`);
  if (marketplace.builtIn) throw new Error(`Built-in marketplace ${name} cannot be removed`);
  const installed = Object.values(config.plugins ?? {}).filter((plugin) => plugin.marketplace?.name === name);
  for (const plugin of installed) await uninstallPlugin(plugin.id, true);
  await mutateConfig((fresh) => { delete fresh.marketplaces?.[name]; });
}

export async function listMarketplacePlugins(query?: string): Promise<MarketplaceListing[]> {
  const initial = await listMarketplaces();
  for (const marketplace of initial) await ensureReady(marketplace);
  const config = loadConfig();
  const needle = query?.trim().toLowerCase();
  const listings: MarketplaceListing[] = [];
  for (const marketplace of Object.values(config.marketplaces ?? {})) {
    if (!marketplace.resolvedRevision) continue;
    try {
      const catalog = marketplaceSnapshot(marketplace);
      for (const entry of catalog.entries) {
        const listing = listingFromEntry(config, marketplace, catalog, entry);
        if (!needle || [listing.name, listing.displayName, listing.description, listing.category, ...listing.tags].some((value) => value?.toLowerCase().includes(needle))) {
          listings.push(listing);
        }
      }
    } catch {
      // Preserve other marketplaces when one cached catalog is invalid.
    }
  }
  return listings.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.marketplace.localeCompare(b.marketplace));
}

export async function inspectMarketplacePlugin(id: string): Promise<MarketplacePluginDetail> {
  const { pluginName, marketplaceName } = parseQualified(id);
  let marketplace = loadConfig().marketplaces?.[marketplaceName];
  if (!marketplace) throw new Error(`Marketplace ${marketplaceName} not found`);
  marketplace = await ensureReady(marketplace);
  const catalog = marketplaceSnapshot(marketplace);
  const entry = catalog.entries.find((candidate) => candidate.name === pluginName);
  if (!entry) throw new Error(`Plugin ${pluginName} not found in ${marketplaceName}`);
  const source = resolveMarketplacePluginSource(catalog, entry);
  if (source.type === "npm") {
    const listing = listingFromEntry(loadConfig(), marketplace, catalog, entry);
    return { ...listing, compatible: false, unsupportedCapabilities: [...new Set([...listing.unsupportedCapabilities, "npm"])], manifest: null, discovered: { skills: [], commands: [], agents: [], hooks: [], mcpServers: [] } };
  }
  const cached = await new PluginCache().fetch(source, pluginName);
  const root = findPluginRoot(cached.root);
  const manifest = readManifest(root);
  const discovered = discoverComponents(root);
  const base = listingFromEntry(loadConfig(), marketplace, catalog, entry);
  const caps = capabilities(root, entry);
  return {
    ...base,
    description: base.description ?? manifest?.description,
    author: base.author ?? manifest?.author,
    homepage: base.homepage ?? manifest?.homepage,
    version: base.version ?? manifest?.version,
    supportedCapabilities: caps.supported,
    unsupportedCapabilities: caps.unsupported,
    compatible: caps.supported.length > 0,
    manifest,
    discovered,
    resolvedSource: source.original,
    sourceFingerprint: `${marketplace.resolvedRevision}:${cached.sha}:${JSON.stringify(entry.source)}`,
  };
}

export async function installMarketplacePlugin(id: string): Promise<import("../types.js").ManagedPlugin> {
  const detail = await inspectMarketplacePlugin(id);
  if (!detail.compatible || !detail.sourceFingerprint) throw new Error(`Plugin ${id} has no mcpx-compatible capabilities`);
  const { marketplaceName, pluginName } = parseQualified(id);
  const marketplace = loadConfig().marketplaces?.[marketplaceName];
  if (!marketplace) throw new Error(`Marketplace ${marketplaceName} not found`);
  const catalog = marketplaceSnapshot(marketplace);
  const entry = catalog.entries.find((candidate) => candidate.name === pluginName)!;
  const source = resolveMarketplacePluginSource(catalog, entry);
  const approvals: Partial<Record<PluginComponent, boolean>> = {};
  for (const capability of detail.supportedCapabilities) {
    if (SUPPORTED.has(capability)) approvals[capability as PluginComponent] = true;
  }
  const manager = new PluginManager();
  return manager.installResolvedPlugin(source, {
    name: pluginName,
    approvals,
    marketplace: { name: marketplaceName, pluginName, sourceFingerprint: detail.sourceFingerprint },
  });
}

export async function updateMarketplaceInstalledPlugin(pluginId: string, sync = true): Promise<import("../types.js").ManagedPlugin> {
  const plugin = loadConfig().plugins?.[pluginId];
  if (!plugin?.marketplace) throw new Error(`Plugin ${pluginId} is not marketplace-managed`);
  const qualified = `${plugin.marketplace.pluginName}@${plugin.marketplace.name}`;
  try {
    const detail = await inspectMarketplacePlugin(qualified);
    if (!detail.compatible || !detail.sourceFingerprint) throw new Error(`Plugin ${qualified} has no mcpx-compatible capabilities`);
    if (detail.sourceFingerprint === plugin.marketplace.sourceFingerprint) return plugin;
    const marketplace = loadConfig().marketplaces?.[plugin.marketplace.name];
    if (!marketplace) throw new Error(`Marketplace ${plugin.marketplace.name} not found`);
    const catalog = marketplaceSnapshot(marketplace);
    const entry = catalog.entries.find((candidate) => candidate.name === plugin.marketplace!.pluginName);
    if (!entry) throw new Error(`Plugin ${qualified} is no longer listed`);
    const source = resolveMarketplacePluginSource(catalog, entry);
    return await new PluginManager().updateResolvedPlugin(pluginId, source, detail.sourceFingerprint, sync);
  } catch (error) {
    await mutateConfig((config) => {
      const current = config.plugins?.[pluginId];
      if (current) current.updateError = error instanceof Error ? error.message : String(error);
    });
    throw error;
  }
}

export async function refreshMarketplaceWithPlugins(name: string): Promise<{ marketplace: ManagedMarketplace; updated: string[]; errors: string[] }> {
  const marketplace = await refreshMarketplace(name);
  const plugins = Object.values(loadConfig().plugins ?? {}).filter((plugin) => plugin.marketplace?.name === name);
  const updated: string[] = [];
  const errors: string[] = [];
  for (const plugin of plugins) {
    try {
      const before = plugin.marketplace!.sourceFingerprint;
      const result = await updateMarketplaceInstalledPlugin(plugin.id, false);
      if (result.marketplace?.sourceFingerprint !== before) updated.push(result.id);
    } catch (error) {
      errors.push(`${plugin.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (updated.length > 0) {
    const { pluginSync } = await import("./plugin-manager.js");
    await pluginSync();
  }
  return { marketplace, updated, errors };
}

export async function refreshAutoUpdateMarketplaces(): Promise<{ checked: string[]; errors: string[] }> {
  const enabled = Object.values(loadConfig().marketplaces ?? {}).filter((marketplace) => marketplace.autoUpdate);
  const checked: string[] = [];
  const errors: string[] = [];
  for (const marketplace of enabled) {
    try {
      await refreshMarketplaceWithPlugins(marketplace.name);
      checked.push(marketplace.name);
    } catch (error) {
      errors.push(`${marketplace.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { checked, errors };
}
