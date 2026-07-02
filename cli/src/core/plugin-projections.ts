import fs from "node:fs";
import path from "node:path";
import { homeDir, ensureDir } from "./paths.js";
import type { PluginSyncInput, PluginSyncResult, ClientId, PluginComponent } from "../types.js";

const OWNERSHIP_MANIFEST = "mcpx-plugins.json";

interface OwnershipManifest {
  version: 1;
  plugins: Record<string, {
    pluginId: string;
    paths: string[];
    installedAt: string;
  }>;
}

function loadOwnership(targetDir: string): OwnershipManifest {
  const manifestPath = path.join(targetDir, OWNERSHIP_MANIFEST);
  if (!fs.existsSync(manifestPath)) {
    return { version: 1, plugins: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    console.error(`[mcpx] Warning: corrupt plugin ownership manifest at ${manifestPath}, resetting`);
    return { version: 1, plugins: {} };
  }
}

function saveOwnership(targetDir: string, manifest: OwnershipManifest): void {
  ensureDir(targetDir);
  fs.writeFileSync(
    path.join(targetDir, OWNERSHIP_MANIFEST),
    JSON.stringify(manifest, null, 2)
  );
}

function recordOwned(targetDir: string, pluginId: string, paths: string[]): void {
  const manifest = loadOwnership(targetDir);
  manifest.plugins[pluginId] = {
    pluginId,
    paths,
    installedAt: new Date().toISOString(),
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
  const paths = removeOwned(targetDir, pluginId);
  for (const p of paths) {
    const fullPath = path.join(targetDir, p);
    try {
      if (fs.existsSync(fullPath)) {
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

function nsName(pluginName: string, id: string): string {
  return `${pluginName}__${id}`;
}

function isComponentApproved(plugin: PluginSyncInput, component: PluginComponent): boolean {
  const approval = plugin.approvals?.[component];
  // Default: allow skills and commands, deny hooks; mcpServers respects component flag
  if (approval === false) return false;
  if (approval === true) return true;
  if (component === "hooks") return false;
  if (component === "mcpServers") return plugin.components.mcpServers;
  return plugin.components[component] ?? false;
}

// --- Claude Code: materialize whole plugin into ~/.claude/skills/<plugin>/ ---
function syncClaude(plugins: PluginSyncInput[]): PluginSyncResult {
  const targetBase = path.join(homeDir(), ".claude", "skills");
  const projectedDirs: string[] = [];
  const unsupported: PluginComponent[] = [];
  const skippedUnapproved: string[] = [];

  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    if (!isComponentApproved(plugin, "skills")) {
      skippedUnapproved.push(`${plugin.pluginName}:skills`);
      continue;
    }

    const targetDir = path.join(targetBase, plugin.pluginName);
    ensureDir(targetDir);

    const mcpJsonSrc = path.join(plugin.pluginRoot, ".mcp.json");
    const mcpJsonDest = path.join(targetDir, ".mcp.json");

    copyPluginDir(plugin.pluginRoot, targetDir, [".mcp.json", ".git"]);

    if (fs.existsSync(mcpJsonDest)) {
      fs.rmSync(mcpJsonDest, { recursive: true, force: true });
    }

    projectedDirs.push(targetDir);
    recordOwned(targetBase, plugin.pluginId, [plugin.pluginName]);
  }

  return {
    clientId: "claude",
    status: projectedDirs.length > 0 || plugins.length === 0 ? "SYNCED" : "SKIPPED",
    projectedDirs,
    unsupported: [],
  };
}

// --- Claude Desktop: MCP only via gateway (no plugin projection needed) ---
function syncClaudeDesktop(plugins: PluginSyncInput[]): PluginSyncResult {
  const unsupported: PluginComponent[] = ["skills", "hooks", "agents", "commands"];
  return {
    clientId: "claude-desktop",
    status: plugins.length > 0 ? "SYNCED" : "SKIPPED",
    projectedDirs: [],
    unsupported,
  };
}

// --- Codex: skills only (commands deprecated) ---
function syncCodex(plugins: PluginSyncInput[]): PluginSyncResult {
  const targetBase = path.join(homeDir(), ".codex", "skills");
  const projectedDirs: string[] = [];
  const unsupported: PluginComponent[] = ["hooks", "agents"];

  for (const plugin of plugins) {
    if (!plugin.enabled) continue;

    if (plugin.components.skills && isComponentApproved(plugin, "skills")) {
      ensureDir(targetBase);
      const owned: string[] = [];
      for (const skill of plugin.skills) {
        const targetDir = path.join(targetBase, nsName(plugin.pluginName, skill.id));
        ensureDir(targetDir);
        copyFileOrDir(skill.path, path.join(targetDir, "SKILL.md"));
        owned.push(nsName(plugin.pluginName, skill.id));
        projectedDirs.push(targetDir);
      }
      recordOwned(targetBase, plugin.pluginId, owned);
    }
  }

  return {
    clientId: "codex",
    status: "SYNCED",
    projectedDirs,
    unsupported,
  };
}

// --- Cursor: skills + commands ---
function syncCursor(plugins: PluginSyncInput[]): PluginSyncResult {
  const skillsBase = path.join(homeDir(), ".cursor", "skills");
  const commandsBase = path.join(homeDir(), ".cursor", "commands");
  const projectedDirs: string[] = [];
  const unsupported: PluginComponent[] = ["hooks", "agents"];

  for (const plugin of plugins) {
    if (!plugin.enabled) continue;

    const ownedSkills: string[] = [];
    const ownedCommands: string[] = [];

    if (plugin.components.skills && isComponentApproved(plugin, "skills")) {
      ensureDir(skillsBase);
      for (const skill of plugin.skills) {
        const targetDir = path.join(skillsBase, nsName(plugin.pluginName, skill.id));
        ensureDir(targetDir);
        copyFileOrDir(skill.path, path.join(targetDir, "SKILL.md"));
        ownedSkills.push(nsName(plugin.pluginName, skill.id));
        projectedDirs.push(targetDir);
      }
    }

    if (plugin.components.commands && isComponentApproved(plugin, "commands")) {
      ensureDir(commandsBase);
      for (const cmd of plugin.commands) {
        const targetPath = path.join(commandsBase, `${nsName(plugin.pluginName, cmd.id)}.md`);
        copyFileOrDir(cmd.path, targetPath);
        ownedCommands.push(`${nsName(plugin.pluginName, cmd.id)}.md`);
        projectedDirs.push(targetPath);
      }
    }

    if (ownedSkills.length > 0) recordOwned(skillsBase, plugin.pluginId, ownedSkills);
    if (ownedCommands.length > 0) recordOwned(commandsBase, plugin.pluginId, ownedCommands);
  }

  return {
    clientId: "cursor",
    status: "SYNCED",
    projectedDirs,
    unsupported,
  };
}

// --- VS Code: skills only ---
function syncVsCode(plugins: PluginSyncInput[]): PluginSyncResult {
  const skillsBase = path.join(homeDir(), ".copilot", "skills");
  const projectedDirs: string[] = [];
  const unsupported: PluginComponent[] = ["hooks", "agents"];

  for (const plugin of plugins) {
    if (!plugin.enabled) continue;

    if (plugin.components.skills && isComponentApproved(plugin, "skills")) {
      ensureDir(skillsBase);
      const owned: string[] = [];
      for (const skill of plugin.skills) {
        const targetDir = path.join(skillsBase, nsName(plugin.pluginName, skill.id));
        ensureDir(targetDir);
        copyFileOrDir(skill.path, path.join(targetDir, "SKILL.md"));
        owned.push(nsName(plugin.pluginName, skill.id));
        projectedDirs.push(targetDir);
      }
      recordOwned(skillsBase, plugin.pluginId, owned);
    }
  }

  return {
    clientId: "vscode",
    status: "SYNCED",
    projectedDirs,
    unsupported,
  };
}

// --- Qwen: skills only ---
function syncQwen(plugins: PluginSyncInput[]): PluginSyncResult {
  const targetBase = path.join(homeDir(), ".qwen", "skills");
  const projectedDirs: string[] = [];
  const unsupported: PluginComponent[] = ["hooks", "agents", "commands"];

  for (const plugin of plugins) {
    if (!plugin.enabled) continue;

    if (plugin.components.skills && isComponentApproved(plugin, "skills")) {
      ensureDir(targetBase);
      const owned: string[] = [];
      for (const skill of plugin.skills) {
        const targetDir = path.join(targetBase, nsName(plugin.pluginName, skill.id));
        ensureDir(targetDir);
        copyFileOrDir(skill.path, path.join(targetDir, "SKILL.md"));
        owned.push(nsName(plugin.pluginName, skill.id));
        projectedDirs.push(targetDir);
      }
      recordOwned(targetBase, plugin.pluginId, owned);
    }
  }

  return {
    clientId: "qwen",
    status: "SYNCED",
    projectedDirs,
    unsupported,
  };
}

// --- Cline: skills only ---
function syncCline(plugins: PluginSyncInput[]): PluginSyncResult {
  const targetBase = path.join(homeDir(), ".config", "cline", "skills");
  const projectedDirs: string[] = [];
  const unsupported: PluginComponent[] = ["hooks", "agents", "commands"];

  for (const plugin of plugins) {
    if (!plugin.enabled) continue;

    if (plugin.components.skills && isComponentApproved(plugin, "skills")) {
      ensureDir(targetBase);
      const owned: string[] = [];
      for (const skill of plugin.skills) {
        const targetDir = path.join(targetBase, nsName(plugin.pluginName, skill.id));
        ensureDir(targetDir);
        copyFileOrDir(skill.path, path.join(targetDir, "SKILL.md"));
        owned.push(nsName(plugin.pluginName, skill.id));
        projectedDirs.push(targetDir);
      }
      recordOwned(targetBase, plugin.pluginId, owned);
    }
  }

  return {
    clientId: "cline",
    status: "SYNCED",
    projectedDirs,
    unsupported,
  };
}

// --- Kiro: skills only ---
function syncKiro(plugins: PluginSyncInput[]): PluginSyncResult {
  const targetBase = path.join(homeDir(), ".kiro", "skills");
  const projectedDirs: string[] = [];
  const unsupported: PluginComponent[] = ["hooks", "agents", "commands"];

  for (const plugin of plugins) {
    if (!plugin.enabled) continue;

    if (plugin.components.skills && isComponentApproved(plugin, "skills")) {
      ensureDir(targetBase);
      const owned: string[] = [];
      for (const skill of plugin.skills) {
        const targetDir = path.join(targetBase, nsName(plugin.pluginName, skill.id));
        ensureDir(targetDir);
        copyFileOrDir(skill.path, path.join(targetDir, "SKILL.md"));
        owned.push(nsName(plugin.pluginName, skill.id));
        projectedDirs.push(targetDir);
      }
      recordOwned(targetBase, plugin.pluginId, owned);
    }
  }

  return {
    clientId: "kiro",
    status: "SYNCED",
    projectedDirs,
    unsupported,
  };
}

// --- OpenCode: MCP only via gateway (no plugin projection needed) ---
function syncOpenCode(plugins: PluginSyncInput[]): PluginSyncResult {
  const unsupported: PluginComponent[] = ["skills", "hooks", "agents", "commands"];
  return {
    clientId: "opencode",
    status: plugins.length > 0 ? "SYNCED" : "SKIPPED",
    projectedDirs: [],
    unsupported,
  };
}

export function syncPluginsToClient(clientId: string, plugins: PluginSyncInput[]): PluginSyncResult {
  const syncMap: Record<string, (plugins: PluginSyncInput[]) => PluginSyncResult> = {
    claude: syncClaude,
    "claude-desktop": syncClaudeDesktop,
    codex: syncCodex,
    cursor: syncCursor,
    vscode: syncVsCode,
    qwen: syncQwen,
    cline: syncCline,
    kiro: syncKiro,
    opencode: syncOpenCode,
  };

  const syncFn = syncMap[clientId];
  if (!syncFn) {
    return { clientId: clientId as ClientId, status: "SKIPPED", projectedDirs: [], unsupported: [] };
  }

  // Prune unlisted plugins before projecting
  const targetBaseMap: Record<string, string> = {
    claude: path.join(homeDir(), ".claude", "skills"),
    "claude-desktop": "",
    codex: path.join(homeDir(), ".codex", "skills"),
    cursor: path.join(homeDir(), ".cursor"),
    vscode: path.join(homeDir(), ".copilot", "skills"),
    qwen: path.join(homeDir(), ".qwen", "skills"),
    cline: path.join(homeDir(), ".config", "cline", "skills"),
    kiro: path.join(homeDir(), ".kiro", "skills"),
    opencode: "",
  };

  const target = targetBaseMap[clientId];
  if (target) {
    const enabledIds = plugins.filter((p) => p.enabled).map((p) => p.pluginId);
    pruneUnlistedPlugins(target, enabledIds);
  }

  return syncFn(plugins);
}

// --- File copy helpers ---
function copyPluginDir(src: string, dest: string, exclude: string[] = [], errors?: string[]): void {
  const excludeSet = new Set(exclude);
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (excludeSet.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyPluginDir(srcPath, destPath, exclude, errors);
    } else if (entry.isFile()) {
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch (e) {
        errors?.push(`Failed to copy ${srcPath}: ${(e as Error).message}`);
      }
    }
  }
}

function copyFileOrDir(src: string, dest: string, errors?: string[]): void {
  try {
    ensureDir(path.dirname(dest));
    if (fs.statSync(src).isDirectory()) {
      copyPluginDir(src, dest, [], errors);
    } else {
      fs.copyFileSync(src, dest);
    }
  } catch (e) {
    errors?.push(`Failed to copy ${src} -> ${dest}: ${(e as Error).message}`);
  }
}
