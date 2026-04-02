import fs from "node:fs";
import path from "node:path";
import { execSync, spawn } from "node:child_process";
import { getUpdatesDir, getUpdateLockPath, ensureDir } from "./paths.js";
import { checkForUpdates, stageUpdate, clearStagedUpdate, getStagedUpdate, removeOldVersions, compareVersions } from "./update.js";

function acquireLock(): boolean {
  const lockPath = getUpdateLockPath();
  try {
    ensureDir(path.dirname(lockPath));
    fs.writeFileSync(lockPath, `${process.pid}\n`, { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

function releaseLock(): void {
  const lockPath = getUpdateLockPath();
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // Ignore cleanup failures
  }
}

function isUpdateInProgress(): boolean {
  const lockPath = getUpdateLockPath();
  if (!fs.existsSync(lockPath)) {
    return false;
  }

  try {
    const raw = fs.readFileSync(lockPath, "utf8").trim();
    const pid = Number(raw);
    if (!Number.isFinite(pid) || pid <= 0) {
      fs.unlinkSync(lockPath);
      return false;
    }

    process.kill(pid, 0);
    return true;
  } catch {
    fs.unlinkSync(lockPath);
    return false;
  }
}

async function downloadAndStageUpdate(): Promise<{ success: boolean; version?: string; error?: string }> {
  const updateStatus = await checkForUpdates();

  if (!updateStatus.latestVersion || !updateStatus.updateAvailable) {
    return { success: false, error: "No update available" };
  }

  const targetVersion = updateStatus.latestVersion;
  const updatesDir = getUpdatesDir();
  const versionDir = path.join(updatesDir, `v${targetVersion}`);

  if (fs.existsSync(versionDir)) {
    const existingStaged = getStagedUpdate();
    if (existingStaged?.version === targetVersion) {
      return { success: false, error: `Version ${targetVersion} already staged` };
    }
  }

  try {
    ensureDir(versionDir);

    execSync(`npm pack @kwonye/mcpx@${targetVersion} --json`, {
      cwd: versionDir,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const tarballPath = path.join(versionDir, `kwonye-mcpx-${targetVersion}.tgz`);
    if (!fs.existsSync(tarballPath)) {
      throw new Error("Downloaded tarball not found");
    }

    execSync(`tar -xzf ${tarballPath} --strip-components=1`, {
      cwd: versionDir,
      stdio: ["pipe", "pipe", "pipe"]
    });

    execSync("npm install --production --ignore-scripts", {
      cwd: versionDir,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const cliPath = path.join(versionDir, "dist", "cli.js");
    if (!fs.existsSync(cliPath)) {
      throw new Error("CLI entry point not found in downloaded package");
    }

    stageUpdate(targetVersion, cliPath);
    removeOldVersions(2);

    return { success: true, version: targetVersion };
  } catch (error) {
    try {
      fs.rmSync(versionDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function startBackgroundUpdateCheck(): void {
  if (isUpdateInProgress()) {
    return;
  }

  if (!acquireLock()) {
    return;
  }

  const child = spawn(process.execPath, [
    process.argv[1] ?? "",
    "update",
    "--background"
  ], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: {
      ...process.env,
      MCPX_UPDATE_CHILD: "1"
    }
  });

  child.unref();

  setTimeout(() => {
    releaseLock();
  }, 60000);
}

export async function runBackgroundUpdate(): Promise<void> {
  try {
    const result = await downloadAndStageUpdate();

    if (result.success && result.version) {
      console.error(`[update-manager] Update staged: v${result.version}. Will activate on next run.`);
    } else if (result.error && result.error !== "No update available") {
      console.error(`[update-manager] Update check failed: ${result.error}`);
    }
  } catch (error) {
    console.error(`[update-manager] Background update failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    releaseLock();
  }
}

export async function performUpdate(): Promise<{ success: boolean; message: string }> {
  if (isUpdateInProgress()) {
    return { success: false, message: "Another update is already in progress." };
  }

  const result = await downloadAndStageUpdate();

  if (result.success && result.version) {
    return {
      success: true,
      message: `Update to v${result.version} ready! Will activate on next run.`
    };
  }

  if (result.error === "No update available") {
    return { success: true, message: "Already on latest version." };
  }

  return {
    success: false,
    message: result.error ?? "Update failed"
  };
}

export function performRollback(): { success: boolean; message: string } {
  const currentStaged = getStagedUpdate();

  if (!currentStaged) {
    return { success: false, message: "No staged update to roll back." };
  }

  clearStagedUpdate();

  return {
    success: true,
    message: `Rolled back from v${currentStaged.version}. Using installed version.`
  };
}
