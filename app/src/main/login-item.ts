import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDesktopProductName } from "./app-flavor";
import { resourcePath } from "./platform/resources";
import { toDesktopPlatform } from "./platform/types";
import {
  isHiddenLaunch,
  linuxAutostartDir,
  linuxAutostartEntry,
  linuxLaunchTarget,
  linuxUserIconPath,
  loginItemSettingsFor
} from "./platform/autostart";

function applyLinuxAutostart(enabled: boolean): void {
  const name = getDesktopProductName();
  const home = os.homedir();
  const desktopFile = path.join(linuxAutostartDir(process.env, home), `${name}.desktop`);

  if (!enabled) {
    fs.rmSync(desktopFile, { force: true });
    return;
  }

  // Copy the icon somewhere stable: the asar and an AppImage mount are not.
  const iconPath = linuxUserIconPath(process.env, home, name);
  try {
    fs.mkdirSync(path.dirname(iconPath), { recursive: true });
    fs.copyFileSync(resourcePath("linux", "icon-256.png"), iconPath);
  } catch (error) {
    console.error("[login-item] failed to install autostart icon:", error);
  }

  fs.mkdirSync(path.dirname(desktopFile), { recursive: true });
  fs.writeFileSync(
    desktopFile,
    linuxAutostartEntry({ name, launchTarget: linuxLaunchTarget(process.execPath, process.env), iconName: name })
  );
}

export function applyStartOnLoginSetting(enabled: boolean): void {
  const platform = toDesktopPlatform();
  if (platform === "linux") {
    applyLinuxAutostart(enabled);
    return;
  }

  const settings = loginItemSettingsFor(platform, enabled, process.execPath, process.env);
  if (settings) {
    app.setLoginItemSettings(settings);
  }
}

/** True when this launch came from login autostart (start hidden in the tray). */
export function wasOpenedAtLogin(argv: readonly string[] = process.argv): boolean {
  const macOpenedAtLogin = toDesktopPlatform() === "darwin"
    && Boolean(app.getLoginItemSettings().wasOpenedAtLogin);
  return isHiddenLaunch(argv, macOpenedAtLogin);
}
