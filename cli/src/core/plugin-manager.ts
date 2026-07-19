import fs from "node:fs";
import path from "node:path";
import { getConfigPath, getPluginDataRoot, ensureDir } from "./paths.js";
import { PluginCache } from "./plugin-cache.js";
import { PluginDataManager } from "./plugin-data.js";
import { PluginLifecycle } from "./plugin-lifecycle.js";
import { parseSource } from "./plugin-source.js";
import { readManifest, discoverComponents, hasManifest } from "./plugin-parse.js";
import { loadConfig, saveConfig } from "./config.js";
import { mutateConfig } from "./config-store.js";
import { syncAllClients, persistSyncState } from "./sync.js";
import { SecretsManager } from "./secrets.js";
import type {
  ManagedPlugin, PluginComponent, PluginManifest,
  DiscoveredComponents
} from "../types.js";

export class PluginManager {
  private configPath: string;
  private cache: PluginCache;
  private dataManager: PluginDataManager;
  private lifecycle: PluginLifecycle;
  private secrets: SecretsManager;

  constructor(configPath?: string) {
    this.configPath = configPath || getConfigPath();
    this.cache = new PluginCache();
    this.dataManager = new PluginDataManager();
    this.lifecycle = new PluginLifecycle();
    this.secrets = new SecretsManager();
  }

  async inspectSource(sourceStr: string): Promise<{
    manifest: PluginManifest | null;
    components: DiscoveredComponents;
    root: string;
    source: string;
    sha: string;
  }> {
    const parsed = parseSource(sourceStr);
    const sha = await this.cache.resolveSha(parsed);
    parsed.resolvedSha = sha;
    const cached = await this.cache.fetch(parsed, "");

    // The plugin root might be a subdirectory — look for .claude-plugin
    let pluginRoot = cached.root;
    if (!hasManifest(pluginRoot)) {
      // Try subdirectories
      const entries = fs.readdirSync(pluginRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const candidate = path.join(pluginRoot, entry.name);
          if (hasManifest(candidate)) {
            pluginRoot = candidate;
            break;
          }
        }
      }
    }

    const manifest = readManifest(pluginRoot);
    const components = discoverComponents(pluginRoot);
    return { manifest, components, root: pluginRoot, source: sourceStr, sha };
  }

  async installPlugin(
    sourceStr: string,
    options?: {
      name?: string;
      components?: Partial<Record<PluginComponent, boolean>>;
      enabled?: boolean;
      approvals?: Partial<Record<PluginComponent, boolean>>;
    }
  ): Promise<ManagedPlugin> {
    const info = await this.inspectSource(sourceStr);
    const pluginName = options?.name || info.manifest?.name || path.basename(info.root);
    const pluginId = `${pluginName}@${info.sha.slice(0, 8)}`;

    const dataDir = path.join(getPluginDataRoot(), pluginId);
    ensureDir(dataDir);

    const enabled = options?.enabled ?? true;
    const discovered = info.components;
    const serverNames: string[] = discovered.mcpServers.map(s => `${pluginName}__${s.id}`);

    const plugin: ManagedPlugin = {
      id: pluginId,
      name: pluginName,
      source: sourceStr,
      version: info.manifest?.version || "0.0.0",
      ref: sourceStr.includes("@") ? sourceStr.split("@")[1] || "latest" : "latest",
      resolvedSha: info.sha,
      installedAt: new Date().toISOString(),
      root: info.root,
      dataDir,
      components: {
        mcpServers: options?.components?.mcpServers ?? discovered.mcpServers.length > 0,
        skills: options?.components?.skills ?? discovered.skills.length > 0,
        hooks: options?.components?.hooks ?? discovered.hooks.length > 0,
        agents: options?.components?.agents ?? discovered.agents.length > 0,
        commands: options?.components?.commands ?? discovered.commands.length > 0,
      },
      discovered,
      enabled,
      status: "healthy",
      serverNames,
      projectedClients: [],
      approvals: options?.approvals || {},
    };

    // Read-check-write happens inside the lock, reloaded fresh from disk, so
    // the "already installed" and name-collision checks below are race-free
    // against a concurrent install/uninstall/update.
    await mutateConfig((config) => {
      if (!config.plugins) config.plugins = {};
      if (config.plugins[pluginId]) {
        throw new Error(`Plugin ${pluginId} is already installed`);
      }

      // Name collision check: ensure no existing plugin has the same server names
      for (const existing of Object.values(config.plugins)) {
        for (const sn of serverNames) {
          if (existing.serverNames.includes(sn)) {
            throw new Error(`Server name collision: "${sn}" is already claimed by plugin "${existing.name}". Use --name to specify a different plugin name.`);
          }
        }
      }

      // Check collision with user-added servers
      for (const sn of serverNames) {
        if (config.servers?.[sn]) {
          throw new Error(`Server name collision: "${sn}" is already registered as a server. Remove that server or use --name to choose a different plugin name.`);
        }
      }

      config.plugins[pluginId] = plugin;

      // Register MCP servers into config.servers with namespace
      for (const mcp of discovered.mcpServers) {
        const nsName = `${pluginName}__${mcp.id}`;
        const approved = plugin.approvals?.mcpServers !== false;
        config.servers[nsName] = {
          transport: "stdio",
          command: "npx",
          args: ["-y", "@kwonye/mcpx@latest", "plugin-host", pluginId, mcp.id],
          enabled: enabled && approved,
        };
      }
    }, this.configPath);

    // Init data
    this.lifecycle.initData(pluginId);

    // Sync projections — sync (slow I/O) runs outside the lock; persisting
    // its result is a second locked mutation against a freshly reloaded
    // config so it can't clobber a concurrent write.
    const syncConfig = loadConfig(this.configPath);
    const summary = syncAllClients(syncConfig, this.secrets);
    await mutateConfig((freshConfig) => {
      persistSyncState(summary, freshConfig);
    }, this.configPath);

    return plugin;
  }

  async updatePlugin(pluginId: string): Promise<ManagedPlugin> {
    // Inspect source outside the lock (slow I/O)
    let currentPlugin: ManagedPlugin | undefined;
    let info: Awaited<ReturnType<typeof this.inspectSource>> | undefined;

    await mutateConfig((config) => {
      if (!config.plugins) throw new Error(`Plugin ${pluginId} not found`);
      const current = config.plugins[pluginId];
      if (!current) throw new Error(`Plugin ${pluginId} not found`);
      currentPlugin = current;
    }, this.configPath);

    // We know currentPlugin is set because mutateConfig didn't throw
    const source = currentPlugin!.source;
    info = await this.inspectSource(source);
    const pluginName = info.manifest?.name || currentPlugin!.name;

    // Now update with freshly-read config inside the lock
    let updatedPlugin: ManagedPlugin | undefined;
    await mutateConfig((config) => {
      if (!config.plugins) throw new Error(`Plugin ${pluginId} not found`);
      const current = config.plugins[pluginId];
      if (!current) throw new Error(`Plugin ${pluginId} not found`);

      // Remove old MCP servers
      for (const oldName of current.serverNames) {
        delete config.servers[oldName];
      }

      // Update plugin record
      current.version = info!.manifest?.version || current.version;
      current.resolvedSha = info!.sha;
      current.root = info!.root;
      current.discovered = info!.components;
      current.serverNames = info!.components.mcpServers.map(s => `${pluginName}__${s.id}`);

      // Re-register MCP servers
      const approved = current.approvals?.mcpServers !== false;
      for (const mcp of info!.components.mcpServers) {
        const nsName = `${pluginName}__${mcp.id}`;
        config.servers[nsName] = {
          transport: "stdio",
          command: "npx",
          args: ["-y", "@kwonye/mcpx@latest", "plugin-host", pluginId, mcp.id],
          enabled: current.enabled && approved,
        };
      }

      // Reset SHA-bound approvals
      current.approvals = {};

      config.plugins[pluginId] = current;
      updatedPlugin = current;
    }, this.configPath);

    // Sync outside the lock (slow I/O)
    const syncConfig = loadConfig(this.configPath);
    const summary = syncAllClients(syncConfig, this.secrets);
    await mutateConfig((freshConfig) => {
      persistSyncState(summary, freshConfig);
    }, this.configPath);

    return updatedPlugin!;
  }

  async uninstallPlugin(pluginId: string, keepData: boolean = false): Promise<void> {
    await mutateConfig((config) => {
      if (!config.plugins) throw new Error(`Plugin ${pluginId} not found`);
      const plugin = config.plugins[pluginId];
      if (!plugin) throw new Error(`Plugin ${pluginId} not found`);

      // Remove MCP servers from config
      for (const name of plugin.serverNames) {
        delete config.servers[name];
      }

      // Remove from config
      delete config.plugins[pluginId];
    }, this.configPath);

    if (!keepData) {
      await this.lifecycle.removeData(pluginId);
    }

    const syncConfig = loadConfig(this.configPath);
    const summary = syncAllClients(syncConfig, this.secrets);
    await mutateConfig((freshConfig) => {
      persistSyncState(summary, freshConfig);
    }, this.configPath);
  }

  async enablePlugin(pluginId: string): Promise<void> {
    // Existence check and enable inside the lock
    await mutateConfig((config) => {
      if (!config.plugins) throw new Error(`Plugin ${pluginId} not found`);
      const plugin = config.plugins[pluginId];
      if (!plugin) throw new Error(`Plugin ${pluginId} not found`);
      plugin.enabled = true;
    }, this.configPath);

    // Sync outside the lock (slow I/O)
    const syncConfig = loadConfig(this.configPath);
    const summary = syncAllClients(syncConfig, this.secrets);
    await mutateConfig((freshConfig) => {
      persistSyncState(summary, freshConfig);
    }, this.configPath);
  }

  async disablePlugin(pluginId: string): Promise<void> {
    // Existence check and disable inside the lock
    await mutateConfig((config) => {
      if (!config.plugins) throw new Error(`Plugin ${pluginId} not found`);
      const plugin = config.plugins[pluginId];
      if (!plugin) throw new Error(`Plugin ${pluginId} not found`);
      plugin.enabled = false;
    }, this.configPath);

    // Sync outside the lock (slow I/O)
    const syncConfig = loadConfig(this.configPath);
    const summary = syncAllClients(syncConfig, this.secrets);
    await mutateConfig((freshConfig) => {
      persistSyncState(summary, freshConfig);
    }, this.configPath);
  }

  async approveComponent(pluginId: string, component: string): Promise<void> {
    // Existence check and approval inside the lock
    await mutateConfig((config) => {
      if (!config.plugins) throw new Error(`Plugin ${pluginId} not found`);
      const plugin = config.plugins[pluginId];
      if (!plugin) throw new Error(`Plugin ${pluginId} not found`);

      if (!plugin.approvals) plugin.approvals = {};
      plugin.approvals[component as PluginComponent] = true;

      // If approving mcpServers, enable the servers
      if (component === "mcpServers") {
        for (const name of plugin.serverNames) {
          if (config.servers[name]) {
            (config.servers[name] as any).enabled = plugin.enabled;
          }
        }
      }
    }, this.configPath);

    // Sync outside the lock (slow I/O)
    const syncConfig = loadConfig(this.configPath);
    const summary = syncAllClients(syncConfig, this.secrets);
    await mutateConfig((freshConfig) => {
      persistSyncState(summary, freshConfig);
    }, this.configPath);
  }

  async getPluginStatus(pluginId: string): Promise<ManagedPlugin | null> {
    const config = loadConfig(this.configPath);
    return config.plugins?.[pluginId] || null;
  }

  async listPlugins(): Promise<ManagedPlugin[]> {
    const config = loadConfig(this.configPath);
    return Object.values(config.plugins || {});
  }

  async preparePlugin(pluginId: string): Promise<void> {
    const config = loadConfig(this.configPath);
    if (!config.plugins) throw new Error(`Plugin ${pluginId} not found`);
    const plugin = config.plugins[pluginId];
    if (!plugin) throw new Error(`Plugin ${pluginId} not found`);
    await this.lifecycle.prepareDependencies(pluginId, plugin.root);
  }
}

// Standalone functions
export async function inspectPlugin(source: string): Promise<{
  manifest: PluginManifest | null;
  components: DiscoveredComponents;
  root: string;
  source: string;
  sha: string;
}> {
  const manager = new PluginManager();
  return manager.inspectSource(source);
}

export async function installPlugin(
  source: string,
  options?: {
    name?: string;
    components?: Partial<Record<PluginComponent, boolean>>;
    enabled?: boolean;
    approvals?: Partial<Record<PluginComponent, boolean>>;
  }
): Promise<ManagedPlugin> {
  const manager = new PluginManager();
  return manager.installPlugin(source, options);
}

export async function updatePlugin(nameOrId: string): Promise<ManagedPlugin> {
  const manager = new PluginManager();
  const config = loadConfig(manager["configPath"]);
  const id = resolvePluginId(config, nameOrId);
  return manager.updatePlugin(id);
}

export async function uninstallPlugin(nameOrId: string, keepData?: boolean): Promise<void> {
  const manager = new PluginManager();
  const config = loadConfig(manager["configPath"]);
  const id = resolvePluginId(config, nameOrId);
  await manager.uninstallPlugin(id, keepData);
}

export async function enablePlugin(nameOrId: string): Promise<void> {
  const manager = new PluginManager();
  const config = loadConfig(manager["configPath"]);
  const id = resolvePluginId(config, nameOrId);
  await manager.enablePlugin(id);
}

export async function disablePlugin(nameOrId: string): Promise<void> {
  const manager = new PluginManager();
  const config = loadConfig(manager["configPath"]);
  const id = resolvePluginId(config, nameOrId);
  await manager.disablePlugin(id);
}

export async function setPluginProjectOverride(
  nameOrId: string,
  projectPath: string,
  override: { enabled?: boolean; components?: Partial<Record<string, boolean>> }
): Promise<void> {
  await mutateConfig((config) => {
    const id = resolvePluginId(config, nameOrId);
    const plugin = config.plugins?.[id];
    if (!plugin) throw new Error(`Plugin ${id} not found`);
    if (!config.projects?.[projectPath]) {
      throw new Error(`Project "${projectPath}" is not registered. Run "mcpx project init" there first.`);
    }
    if (!plugin.projectOverrides) plugin.projectOverrides = {};
    plugin.projectOverrides[projectPath] = { ...plugin.projectOverrides[projectPath], ...override };
  });

  const secrets = new SecretsManager();
  const syncConfig = loadConfig();
  const summary = syncAllClients(syncConfig, secrets);
  await mutateConfig((freshConfig) => {
    persistSyncState(summary, freshConfig);
  });
}

export async function approvePluginComponent(nameOrId: string, component: string): Promise<void> {
  const manager = new PluginManager();
  const config = loadConfig(manager["configPath"]);
  const id = resolvePluginId(config, nameOrId);
  await manager.approveComponent(id, component);
}

export async function getPluginStatus(nameOrId?: string): Promise<ManagedPlugin | null> {
  const manager = new PluginManager();
  if (nameOrId) {
    const config = loadConfig(manager["configPath"]);
    const id = resolvePluginId(config, nameOrId);
    return manager.getPluginStatus(id);
  }
  const plugins = await manager.listPlugins();
  return plugins[0] || null;
}

export async function listPlugins(): Promise<ManagedPlugin[]> {
  const manager = new PluginManager();
  return manager.listPlugins();
}

/**
 * Resolve a plugin identifier — accepts either the full id (`name@sha`) or the
 * user-facing plugin name. Throws if ambiguous or not found.
 */
export function resolvePluginId(config: { plugins?: Record<string, ManagedPlugin> }, nameOrId: string): string {
  const plugins = config.plugins ?? {};
  if (plugins[nameOrId]) return nameOrId;
  const matches = Object.keys(plugins).filter((id) => plugins[id].name === nameOrId);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw new Error(`Plugin "${nameOrId}" not found. Available: ${Object.values(plugins).map((p) => `${p.name} (${p.id})`).join(", ") || "none"}`);
  }
  throw new Error(`Multiple plugins match "${nameOrId}": ${matches.join(", ")}. Use the full id (<name>@<sha8>).`);
}

export async function pluginConfigSet(nameOrId: string, key: string, value: string, projectPath?: string): Promise<void> {
  const manager = new PluginManager();
  const configPath = manager["configPath"];

  // ID resolution and config mutation inside the lock
  await mutateConfig((config) => {
    const id = resolvePluginId(config, nameOrId);
    const plugin = config.plugins?.[id];
    if (!plugin) throw new Error(`Plugin ${id} not found`);
    if (projectPath) {
      if (!plugin.projectOverrides) plugin.projectOverrides = {};
      if (!plugin.projectOverrides[projectPath]) plugin.projectOverrides[projectPath] = {};
      if (!plugin.projectOverrides[projectPath].config) plugin.projectOverrides[projectPath].config = {};
      (plugin.projectOverrides[projectPath].config as Record<string, unknown>)[key] = value;
    } else {
      if (!plugin.config) plugin.config = {};
      (plugin.config as Record<string, unknown>)[key] = value;
    }
  }, configPath);
}

export async function pluginSync(): Promise<void> {
  // Load config and compute sync outside the lock (slow I/O)
  const config = loadConfig();
  const secrets = new SecretsManager();
  const summary = syncAllClients(config, secrets);

  // Persist sync state inside the lock with fresh reload
  await mutateConfig((freshConfig) => {
    persistSyncState(summary, freshConfig);
  });
}

export async function preparePlugin(name: string): Promise<void> {
  const manager = new PluginManager();
  await manager.preparePlugin(name);
}
