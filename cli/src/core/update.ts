import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { APP_VERSION } from "../version.js";
import { getUpdatesDir, getStagedVersionPath, ensureDir } from "./paths.js";

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  error?: string;
}

export interface StagedUpdateInfo {
  version: string;
  cliPath: string;
  stagedAt: string;
}

export function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);

  for (let i = 0; i < 3; i += 1) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }

  return 0;
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  try {
    const output = execFileSync("npm", ["view", "@kwonye/mcpx", "version"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();

    const latestVersion = output;
    const updateAvailable = compareVersions(latestVersion, APP_VERSION) > 0;

    return {
      currentVersion: APP_VERSION,
      latestVersion,
      updateAvailable
    };
  } catch (error) {
    return {
      currentVersion: APP_VERSION,
      latestVersion: null,
      updateAvailable: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function getStagedUpdate(): StagedUpdateInfo | null {
  const stagedPath = getStagedVersionPath();
  if (!fs.existsSync(stagedPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(stagedPath, "utf8");
    const info = JSON.parse(raw) as StagedUpdateInfo;

    if (!info.version || !info.cliPath) {
      return null;
    }

    const absoluteCliPath = path.isAbsolute(info.cliPath)
      ? info.cliPath
      : path.join(getUpdatesDir(), info.cliPath);

    if (!fs.existsSync(absoluteCliPath)) {
      return null;
    }

    return {
      ...info,
      cliPath: absoluteCliPath
    };
  } catch {
    return null;
  }
}

export function stageUpdate(version: string, cliPath: string): void {
  const updatesDir = getUpdatesDir();
  ensureDir(updatesDir);

  const stagedInfo: StagedUpdateInfo = {
    version,
    cliPath: path.isAbsolute(cliPath) ? path.relative(updatesDir, cliPath) : cliPath,
    stagedAt: new Date().toISOString()
  };

  fs.writeFileSync(getStagedVersionPath(), JSON.stringify(stagedInfo, null, 2), "utf8");
}

export function clearStagedUpdate(): void {
  const stagedPath = getStagedVersionPath();
  if (fs.existsSync(stagedPath)) {
    fs.unlinkSync(stagedPath);
  }
}

export function getStagedCliPath(): string | null {
  const staged = getStagedUpdate();
  return staged?.cliPath ?? null;
}

export function removeOldVersions(keepCount = 2): void {
  const updatesDir = getUpdatesDir();
  if (!fs.existsSync(updatesDir)) {
    return;
  }

  const entries = fs.readdirSync(updatesDir, { withFileTypes: true });
  const versionDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("v"))
    .map((entry) => entry.name)
    .sort((a, b) => compareVersions(b.slice(1), a.slice(1)));

  if (versionDirs.length <= keepCount) {
    return;
  }

  for (const oldVersion of versionDirs.slice(keepCount)) {
    const oldPath = path.join(updatesDir, oldVersion);
    try {
      fs.rmSync(oldPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures
    }
  }
}
