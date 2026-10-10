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

    try {
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
        throw new Error("Plugin npm dependencies could not be prepared");
      }
    }

    // Check for requirements.txt
    const reqPath = path.join(pluginRoot, "requirements.txt");
    if (fs.existsSync(reqPath)) {
      try {
        const venv = path.join(dataDir, "venv");
        await execFileAsync("python3", ["-m", "venv", venv], { timeout: 120000 });
        const python = path.join(venv, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
        await execFileAsync(python, ["-m", "pip", "install", "-r", reqPath], {
          timeout: 120000,
        });
      } catch {
        throw new Error("Plugin Python dependencies could not be prepared");
      }
    }

    await this.dataManager.updateStatus(pluginId, "healthy");
    } catch (error) {
      await this.dataManager.updateStatus(pluginId, "error");
      throw error;
    }
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
