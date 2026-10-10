import fs from "node:fs";
import path from "node:path";
import { getAdapters } from "../adapters/index.js";
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
  detected: boolean;
  mode: SyncMode;
  transports: string[];
  components: string[];
  reload: string;
}

export function installationAdapters(config: McpxConfig): Array<{ installation: HarnessInstallation; adapter: ClientAdapter }> {
  const result: Array<{ installation: HarnessInstallation; adapter: ClientAdapter }> = [];
  for (const adapter of getAdapters()) {
    const skillPaths = adapter.skillDirectory ? [adapter.skillDirectory()] : adapter.descriptor?.skillPath ? [path.join(homeDir(), adapter.descriptor.skillPath)] : [];
    skillPaths.push(...(adapter.additionalSkillDirectories?.() ?? []));
    const configPath = adapter.detectConfigPath();
    const mode = config.harnesses?.[adapter.id]?.mode ?? "selected";
    result.push({ adapter, installation: { id: adapter.id, harness: adapter.id, label: adapter.descriptor?.label ?? adapter.id, scope: "global", configPath, skillPaths, detected: Boolean(configPath && fs.existsSync(configPath)) || Boolean(skillPaths[0] && fs.existsSync(skillPaths[0])), mode, transports: adapter.supportsHttp() ? ["http", "stdio"] : ["stdio"], components: adapter.syncSkills && skillPaths.length ? ["mcp", "skill"] : ["mcp"], reload: "Reload the harness configuration or restart its session." } });
    for (const project of Object.values(config.projects ?? {})) {
      const relative = adapter.descriptor?.projectConfig;
      if (!relative) continue;
      const id = `${adapter.id}@${path.resolve(project.path)}`;
      const scoped: ClientAdapter = Object.create(adapter);
      Object.defineProperty(scoped, "id", { value: id });
      scoped.detectConfigPath = () => path.join(project.path, relative);
      scoped.descriptor = adapter.descriptor;
      const scopedPath = scoped.detectConfigPath();
      const skillPath = path.join(project.path, adapter.descriptor?.projectSkills ?? `.${adapter.id}/skills`);
      result.push({ adapter: scoped, installation: { id, harness: adapter.id, label: `${adapter.descriptor?.label ?? adapter.id} · ${project.name}`, scope: "project", projectPath: project.path, configPath: scopedPath, skillPaths: [skillPath], detected: Boolean(scopedPath && fs.existsSync(scopedPath)) || fs.existsSync(skillPath), mode: config.harnesses?.[id]?.mode ?? "observe", transports: adapter.supportsHttp() ? ["http", "stdio"] : ["stdio"], components: ["mcp", "skill"], reload: "Reload the project session." } });
    }
  }
  return result;
}
export function listHarnesses(config: McpxConfig): HarnessInstallation[] { return installationAdapters(config).map(item => item.installation); }
