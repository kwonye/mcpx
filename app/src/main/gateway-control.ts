import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { getDaemonStatus, loadConfig, SecretsManager, startDaemon, stopDaemon } from "@mcpx/core";
import { resolveCliDaemonPath } from "./cli-path";
import { updateTrayForDaemonStatus } from "./tray";

function cliDaemonPath(): string {
  return resolveCliDaemonPath(process.resourcesPath, app.getAppPath());
}

/** Reads the real daemon state (it may have been started or stopped by the CLI). */
export function refreshGatewayStatus(): boolean {
  let running = false;
  try {
    running = getDaemonStatus(loadConfig()).running;
  } catch (error) {
    console.error("[main] failed to read gateway status:", error);
  }
  updateTrayForDaemonStatus(running);
  return running;
}

export async function startGateway(): Promise<void> {
  try {
    await startDaemon(loadConfig(), cliDaemonPath(), new SecretsManager());
    updateTrayForDaemonStatus(true);
  } catch (error) {
    console.error("[main] failed to start gateway:", error);
    refreshGatewayStatus();
  }
}

export function stopGateway(): void {
  try {
    stopDaemon();
  } catch (error) {
    console.error("[main] failed to stop gateway:", error);
  }
  refreshGatewayStatus();
}

function resumeMarkerPath(): string {
  return path.join(app.getPath("userData"), "resume-gateway-after-update");
}

/**
 * Before an app update is installed: the gateway runs from the app's bundled
 * CLI and Electron binary, which the installer replaces (and which Windows
 * keeps locked while running). Stop it and leave a marker so the updated app
 * starts it again.
 */
export function stopGatewayForUpdate(): void {
  if (!refreshGatewayStatus()) {
    return;
  }
  try {
    fs.mkdirSync(path.dirname(resumeMarkerPath()), { recursive: true });
    fs.writeFileSync(resumeMarkerPath(), "1");
  } catch (error) {
    console.error("[main] failed to record gateway resume marker:", error);
  }
  stopGateway();
}

/** True (and the marker is consumed) when an update stopped the gateway. */
export function consumeGatewayResumeMarker(): boolean {
  try {
    fs.rmSync(resumeMarkerPath());
    return true;
  } catch {
    return false;
  }
}
