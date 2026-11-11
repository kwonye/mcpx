import fs from "node:fs";
import path from "node:path";
import { CatalogueAdapter, getAdapters, type HostContext } from "../adapters/index.js";
import { homeDir } from "./paths.js";
import type { ClientAdapter, McpxConfig } from "../types.js";

export type SyncMode = "observe" | "selected" | "automatic";
export interface HarnessInstallation {
  id: string;
  harness: string;
  label: string;
  scope: "global" | "project";
  projectPath?: string;
  configPath: string | null;
  skillPaths: string[];
  /** Installed on this machine (catalogue install detection; for projects, config or skills present). */
  detected: boolean;
  mode: SyncMode;
  transports: string[];
  components: string[];
  reload: string;
  sync?: McpxConfig["clients"][string];
}

/** Project-scoped variant of an adapter registered outside the catalogue. */
function scopedExtraAdapter(adapter: ClientAdapter, projectPath: string, relative: string): ClientAdapter {
  const scoped: ClientAdapter = Object.create(adapter);
  Object.defineProperty(scoped, "id", { value: `${adapter.id}@${path.resolve(projectPath)}` });
  scoped.detectConfigPath = () => path.join(projectPath, relative);
  scoped.skillDirectory = () => path.join(projectPath, adapter.descriptor?.projectSkills ?? `.${adapter.id}/skills`);
  scoped.additionalSkillDirectories = () => [];
  scoped.detectInstallation = () => ({ installed: fs.existsSync(scoped.detectConfigPath()!) || fs.existsSync(scoped.skillDirectory!()) });
  scoped.descriptor = adapter.descriptor;
  return scoped;
}

function isDetected(adapter: ClientAdapter, configPath: string | null, skillPaths: string[]): boolean {
  if (adapter.detectInstallation) return adapter.detectInstallation().installed;
  return Boolean(configPath && fs.existsSync(configPath)) || Boolean(skillPaths[0] && fs.existsSync(skillPaths[0]));
}

/** Every harness installation: each client globally, plus each client with a project config per registered project. */
export function installationAdapters(config: McpxConfig, host: Partial<HostContext> = {}): Array<{ installation: HarnessInstallation; adapter: ClientAdapter }> {
  const result: Array<{ installation: HarnessInstallation; adapter: ClientAdapter }> = [];
  for (const adapter of getAdapters(host)) {
    const label = adapter.descriptor?.label ?? adapter.displayName ?? adapter.id;
    const skillPaths = adapter.skillDirectory ? [adapter.skillDirectory()] : adapter.descriptor?.skillPath ? [path.join(homeDir(), adapter.descriptor.skillPath)] : [];
    skillPaths.push(...(adapter.additionalSkillDirectories?.() ?? []));
    const configPath = adapter.detectConfigPath();
    const mode = config.harnesses?.[adapter.id]?.mode ?? "selected";
    result.push({ adapter, installation: { id: adapter.id, harness: adapter.id, label, scope: "global", configPath, skillPaths, detected: isDetected(adapter, configPath, skillPaths), mode, transports: adapter.supportsHttp() ? ["http", "stdio"] : ["stdio"], components: adapter.syncSkills && skillPaths.length ? ["mcp", "skill"] : ["mcp"], reload: "Reload the harness configuration or restart its session." } });
    for (const project of Object.values(config.projects ?? {})) {
      const relative = adapter.descriptor?.projectConfig;
      if (!relative) continue;
      const scoped = adapter instanceof CatalogueAdapter ? adapter.forProject(project.path) : scopedExtraAdapter(adapter, project.path, relative);
      if (!scoped) continue;
      const scopedPath = scoped.detectConfigPath();
      const skillPath = scoped.skillDirectory!();
      result.push({ adapter: scoped, installation: { id: scoped.id, harness: adapter.id, label: `${label} · ${project.name}`, scope: "project", projectPath: project.path, configPath: scopedPath, skillPaths: [skillPath], detected: isDetected(scoped, scopedPath, [skillPath]), mode: config.harnesses?.[scoped.id]?.mode ?? "observe", transports: adapter.supportsHttp() ? ["http", "stdio"] : ["stdio"], components: ["mcp", "skill"], reload: "Reload the project session." } });
    }
  }
  return result;
}
export function listHarnesses(config: McpxConfig, host: Partial<HostContext> = {}): HarnessInstallation[] {
  return installationAdapters(config, host).map(({ installation }) => ({ ...installation, sync: config.clients[installation.id] }));
}

/**
 * Installations a sync without explicit targets writes to: detected ones and any
 * the user configured. Explicit targets are validated and returned as given.
 */
export function synchronizationTargets(config: McpxConfig, targets?: string[], host: Partial<HostContext> = {}): string[] {
  const installations = listHarnesses(config, host);
  if (targets !== undefined && targets.length > 0) {
    const unknown = targets.filter(id => !installations.some(installation => installation.id === id));
    if (unknown.length) throw new Error(`Unknown harness installation: ${unknown.join(", ")}`);
    return [...new Set(targets)];
  }
  return installations.filter(installation => installation.detected || config.harnesses?.[installation.id]).map(installation => installation.id);
}
