import { app } from "electron";
import {
  loadConfig,
  startDaemon,
  SecretsManager
} from "@mcpx/core";
import { createTray } from "./tray";
import { registerIpcHandlers } from "./ipc-handlers";
import { runDaemonChildIfRequested } from "./daemon-child";
import { loadDesktopSettings } from "./settings-store";
import { applyStartOnLoginSetting, wasOpenedAtLogin } from "./login-item";
import { setAutoUpdateEnabled } from "./update-manager";

function daemonEntrypointArg(): string {
  return process.argv[1] ?? app.getAppPath();
}

async function maybeStartDaemonForLoginLaunch(): Promise<void> {
  const settings = loadDesktopSettings();
  if (!settings.startOnLoginEnabled || !wasOpenedAtLogin()) {
    return;
  }

  const config = loadConfig();
  const secrets = new SecretsManager();
  await startDaemon(config, daemonEntrypointArg(), secrets);
}

export async function startMainProcess(): Promise<void> {
  if (await runDaemonChildIfRequested()) {
    return;
  }

  app.dock?.hide(); // Hide dock icon — menubar app

  await app.whenReady();

  const settings = loadDesktopSettings();
  applyStartOnLoginSetting(settings.startOnLoginEnabled);
  setAutoUpdateEnabled(settings.autoUpdateEnabled);

  registerIpcHandlers();
  createTray();

  try {
    await maybeStartDaemonForLoginLaunch();
  } catch (error) {
    console.error("[main] failed to auto-start daemon on login launch:", error);
  }
}

if (process.env.VITEST !== "true") {
  void startMainProcess().catch((error) => {
    console.error("[main] startup failed:", error);
    app.exit(1);
  });
}
