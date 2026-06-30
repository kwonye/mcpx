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
    return { version: 1, plugins: {} };
  }
}

function saveOwnership(targetDir: string, manifest: OwnershipManifest): void {
  fs.writeFileSync(
    path.join(targetDir, OWNERSHIP_MANIFEST),
    JSON.stringify(manifest, null, 2)
  );
}

function recordOwned(targetDir: string, pluginId: string, paths: string[]): void {
  ensureDir(targetDir);
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

function nsName(pluginName: string, id: string): string {
  return `${pluginName}__${id}`;
}

// --- Claude Code: materialize whole plugin into ~/.claude/skills/<plugin>/ ---
function syncClaude(plugins: PluginSyncInput[]): PluginSyncResult {
  const targetBase = path.join(homeDir(), ".claude", "skills");
  const projectedDirs: string[] = [];
  const unsupported: PluginComponent[] = [];

  for (const plugin of plugins) {
    if (!plugin.enabled) continue;

    const targetDir = path.join(targetBase, plugin.pluginName);
    ensureDir(targetDir);

    // Strip .mcp.json to prevent Claude from loading MCP servers natively (gateway owns them)
    const mcpJsonSrc = path.join(plugin.pluginRoot, ".mcp.json");
    const mcpJsonDest = path.join(targetDir, ".mcp.json");

    // Copy plugin root to skills dir, excluding .mcp.json
    copyPluginDir(plugin.pluginRoot, targetDir, [".mcp.json", ".git"]);

    // Remove MCP JSON if it was copied
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
  // MCP servers are already handled by syncAllClients → gateway
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
    if (!plugin.enabled || !plugin.components.skills) continue;
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

  const ownedSkills: string[] = [];
  const ownedCommands: string[] = [];

  for (const plugin of plugins) {
    if (!plugin.enabled) continue;

    if (plugin.components.skills) {
      ensureDir(skillsBase);
      for (const skill of plugin.skills) {
        const targetDir = path.join(skillsBase, nsName(plugin.pluginName, skill.id));
        ensureDir(targetDir);
        copyFileOrDir(skill.path, path.join(targetDir, "SKILL.md"));
        ownedSkills.push(nsName(plugin.pluginName, skill.id));
        projectedDirs.push(targetDir);
      }
    }

    if (plugin.components.commands) {
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
    if (!plugin.enabled || !plugin.components.skills) continue;
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

  return {
    clientId: "vscode",
    status: "SYNCED",
    projectedDirs,
    unsupported,
  };
}

// --- Kiro: skills only ---
function syncKiro(plugins: PluginSyncInput[]): PluginSyncResult {
  const skillsBase = path.join(homeDir(), ".kiro", "skills");
  const projectedDirs: string[] = [];
  const unsupported: PluginComponent[] = ["hooks", "agents", "commands"];

  for (const plugin of plugins) {
    if (!plugin.enabled || !plugin.components.skills) continue;
    ensureDir(skillsBase);

    const owned: string[] = [];
    for (const skill of plugin.skills) {
      const targetPath = path.join(skillsBase, `${nsName(plugin.pluginName, skill.id)}.md`);
      copyFileOrDir(skill.path, targetPath);
      owned.push(`${nsName(plugin.pluginName, skill.id)}.md`);
      projectedDirs.push(targetPath);
    }
    recordOwned(skillsBase, plugin.pluginId, owned);
  }

  return {
    clientId: "kiro",
    status: "SYNCED",
    projectedDirs,
    unsupported,
  };
}

// --- Qwen: skills + commands ---
function syncQwen(plugins: PluginSyncInput[]): PluginSyncResult {
  const skillsBase = path.join(homeDir(), ".qwen", "skills");
  const commandsBase = path.join(homeDir(), ".qwen", "commands");
  const projectedDirs: string[] = [];
  const unsupported: PluginComponent[] = ["hooks", "agents"];

  const ownedSkills: string[] = [];
  const ownedCommands: string[] = [];

  for (const plugin of plugins) {
    if (!plugin.enabled) continue;

    if (plugin.components.skills) {
      ensureDir(skillsBase);
      for (const skill of plugin.skills) {
        const targetPath = path.join(skillsBase, `${nsName(plugin.pluginName, skill.id)}.md`);
        copyFileOrDir(skill.path, targetPath);
        ownedSkills.push(`${nsName(plugin.pluginName, skill.id)}.md`);
        projectedDirs.push(targetPath);
      }
    }

    if (plugin.components.commands) {
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
    clientId: "qwen",
    status: "SYNCED",
    projectedDirs,
    unsupported,
  };
}

// --- Main dispatch ---
const CLIENT_SYNCERS: Record<string, (plugins: PluginSyncInput[]) => PluginSyncResult> = {
  claude: syncClaude,
  "claude-desktop": syncClaudeDesktop,
  codex: syncCodex,
  cursor: syncCursor,
  vscode: syncVsCode,
  kiro: syncKiro,
  qwen: syncQwen,
};

export function syncPluginsToClient(
  clientId: ClientId,
  plugins: PluginSyncInput[]
): PluginSyncResult {
  const syncer = CLIENT_SYNCERS[clientId];
  if (!syncer) {
    return {
      clientId,
      status: "SKIPPED",
      projectedDirs: [],
      unsupported: ["mcpServers", "skills", "hooks", "agents", "commands"],
      error: `No plugin sync implementation for ${clientId}`,
    };
  }
  return syncer(plugins);
}

// --- Helpers ---
function copyPluginDir(src: string, dest: string, exclude: string[] = []): void {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue;
    if (entry.name.startsWith(".") && entry.name !== ".claude-plugin") continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyPluginDir(srcPath, destPath, exclude);
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyFileOrDir(src: string, dest: string): void {
  ensureDir(path.dirname(dest));
  if (fs.statSync(src).isDirectory()) {
    copyPluginDir(src, dest);
  } else {
    fs.copyFileSync(src, dest);
  }
}
