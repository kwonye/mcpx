import { app } from "electron";

function isSupportedPlatform(): boolean {
  return process.platform === "darwin";
}

export function applyStartOnLoginSetting(enabled: boolean): void {
  if (!isSupportedPlatform()) {
    return;
  }

  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: enabled
  });
}

export function wasOpenedAtLogin(): boolean {
  if (!isSupportedPlatform()) {
    return false;
  }

  return Boolean(app.getLoginItemSettings().wasOpenedAtLogin);
}
