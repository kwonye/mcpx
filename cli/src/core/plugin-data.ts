import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getPluginDataRoot, ensureDir } from "./paths.js";
import { readJsonFile, writeJsonAtomic } from "../util/fs.js";

export interface PluginData {
  id: string;
  dependencies: Record<string, string>;
  settings: Record<string, unknown>;
  logs: Array<{ timestamp: string; level: "info" | "warn" | "error"; message: string; }>;
  status: "healthy" | "unhealthy" | "preparing" | "updating" | "error";
  error?: string;
  lastHealthCheck?: string;
  installedAt: string;
}

export class PluginDataManager {
  private dataRoot: string;

  constructor() {
    this.dataRoot = getPluginDataRoot();
    ensureDir(this.dataRoot);
  }

  private getPluginDataDir(pluginId: string): string {
    return path.join(this.dataRoot, pluginId);
  }

  private getPluginDataPath(pluginId: string): string {
    return path.join(this.getPluginDataDir(pluginId), "data.json");
  }

  async loadData(pluginId: string): Promise<PluginData | null> {
    const dataPath = this.getPluginDataPath(pluginId);
    if (!fs.existsSync(dataPath)) {
      return null;
    }

    try {
      const data = readJsonFile<PluginData | null>(dataPath, null);
      return data;
    } catch {
      return null;
    }
  }

  async saveData(pluginId: string, data: Partial<PluginData>): Promise<void> {
    const existing = await this.loadData(pluginId) || {} as PluginData;
    const merged = { ...existing, ...data };

    const dataPath = this.getPluginDataPath(pluginId);
    ensureDir(path.dirname(dataPath));
    writeJsonAtomic(dataPath, merged);
  }

  async updateDependency(pluginId: string, packageName: string, version: string): Promise<void> {
    const data = await this.loadData(pluginId);
    if (!data) {
      return;
    }

    if (!data.dependencies) {
      data.dependencies = {};
    }

    data.dependencies[packageName] = version;
    await this.saveData(pluginId, data);
  }

  async getDependencies(pluginId: string): Promise<Record<string, string>> {
    const data = await this.loadData(pluginId);
    return data?.dependencies || {};
  }

  async addLog(pluginId: string, level: "info" | "warn" | "error", message: string): Promise<void> {
    const data = await this.loadData(pluginId);
    if (!data) {
      return;
    }

    if (!data.logs) {
      data.logs = [];
    }

    data.logs.push({
      timestamp: new Date().toISOString(),
      level,
      message
    });

    if (data.logs.length > 1000) {
      data.logs = data.logs.slice(-1000);
    }

    await this.saveData(pluginId, data);
  }

  async updateStatus(pluginId: string, status: PluginData["status"], error?: string): Promise<void> {
    const data = await this.loadData(pluginId);
    if (!data) {
      return;
    }

    data.status = status;
    if (error) {
      data.error = error;
    }
    data.lastHealthCheck = new Date().toISOString();

    await this.saveData(pluginId, data);
  }

  async removeData(pluginId: string): Promise<void> {
    const dataDir = this.getPluginDataDir(pluginId);
    if (fs.existsSync(dataDir)) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }

  async cleanupOrphanedData(): Promise<void> {
    if (!fs.existsSync(this.dataRoot)) {
      return;
    }

    const pluginIds = fs.readdirSync(this.dataRoot);
    for (const pluginId of pluginIds) {
      const pluginDir = path.join(this.dataRoot, pluginId);
      if (!fs.statSync(pluginDir).isDirectory()) {
        continue;
      }

      const dataPath = path.join(pluginDir, "data.json");
      if (!fs.existsSync(dataPath)) {
        fs.rmSync(pluginDir, { recursive: true, force: true });
      }
    }
  }
}