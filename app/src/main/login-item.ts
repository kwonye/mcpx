import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { app as electronApp } from "electron";

function isMac(): boolean {
  return process.platform === "darwin";
}

function isLinux(): boolean {
  return process.platform === "linux";
}

export function applyStartOnLoginSetting(enabled: boolean): void {
  if (isMac()) {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: enabled
    });
    return;
  }

  if (isLinux()) {
    const autostartDir = path.join(
      process.env.HOME ?? "",
      ".config",
      "autostart"
    );
    const desktopFile = path.join(autostartDir, "mcpx.desktop");

    if (enabled) {
      fs.mkdirSync(autostartDir, { recursive: true });
      const execPath = process.execPath;
      const iconPath = path.join(__dirname, "../../resources/linux/tray-icon.png");
      const desktopEntry = `[Desktop Entry]
Type=Application
Name=mcpx
Comment=Local MCP gateway
Exec=${execPath}
Icon=${iconPath}
Terminal=false
X-GNOME-Autostart-enabled=true
`;
      fs.writeFileSync(desktopFile, desktopEntry);
    } else {
      try {
        fs.unlinkSync(desktopFile);
      } catch {
        // Ignore if file doesn't exist
      }
    }
    return;
  }

  // Windows: use Electron's built-in login item settings (writes to registry)
  if (process.platform === "win32") {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: enabled,
      path: process.execPath
    });
  }
}

export function wasOpenedAtLogin(): boolean {
  if (isMac()) {
    return Boolean(app.getLoginItemSettings().wasOpenedAtLogin);
  }

  // Linux: check for --hidden or --autostart flag in argv
  if (isLinux()) {
    return process.argv.includes("--autostart") || process.argv.includes("--hidden");
  }

  // Windows: Electron's getLoginItemSettings detects startup launches
  if (process.platform === "win32") {
    return Boolean(app.getLoginItemSettings().wasOpenedAtLogin);
  }

  return false;
}
