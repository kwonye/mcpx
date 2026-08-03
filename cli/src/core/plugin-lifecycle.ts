import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PluginDataManager } from "./plugin-data.js";
import { getPluginDataRoot, ensureDir } from "./paths.js";
import type { DiscoveredComponents, ManagedPlugin } from "../types.js";

const execFileAsync = promisify(execFile);

export class PluginLifecycle {
  private dataManager: PluginDataManager;

  constructor() {
    this.dataManager = new PluginDataManager();
  }

  async prepareDependencies(pluginId: string, pluginRoot: string): Promise<void> {
    await this.dataManager.updateStatus(pluginId, "preparing");
    const dataDir = path.join(getPluginDataRoot(), pluginId);
    ensureDir(dataDir);

    // Check for package.json
    const pkgJsonPath = path.join(pluginRoot, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (Object.keys(deps).length > 0) {
          await execFileAsync("npm", ["install", "--production", "--ignore-scripts"], {
            cwd: pluginRoot,
            timeout: 120000,
          });
        }
      } catch {
        // npm install may fail; continue
      }
    }

    // Check for requirements.txt
    const reqPath = path.join(pluginRoot, "requirements.txt");
    if (fs.existsSync(reqPath)) {
      try {
        await execFileAsync("pip", ["install", "-r", reqPath], {
          timeout: 120000,
        });
      } catch {
        // pip may fail; continue
      }
    }

    await this.dataManager.updateStatus(pluginId, "healthy");
  }

  async removeData(pluginId: string): Promise<void> {
    await this.dataManager.removeData(pluginId);
  }

  initData(pluginId: string): void {
    const dataDir = path.join(getPluginDataRoot(), pluginId);
    ensureDir(dataDir);
    this.dataManager.saveData(pluginId, {
      id: pluginId,
      dependencies: {},
      settings: {},
      logs: [],
      status: "healthy",
      installedAt: new Date().toISOString(),
    });
  }
}
