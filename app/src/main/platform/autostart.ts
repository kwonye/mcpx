import path from "node:path";
import type { DesktopPlatform } from "./types";

/** Added to the login item / autostart entry so a login launch starts hidden in the tray. */
export const HIDDEN_LAUNCH_ARG = "--hidden";

/**
 * Quote one argument of a desktop entry `Exec=` key (Desktop Entry spec,
 * "The Exec key"): arguments with reserved characters go in double quotes
 * with `"`, `` ` ``, `$` and `\` backslash-escaped, `%` is doubled, and the
 * whole value is then escaped as a string value (`\` becomes `\\`).
 */
export function quoteDesktopExecArg(arg: string): string {
  const percentEscaped = arg.replace(/%/g, "%%");
  if (/^[A-Za-z0-9_\-./=+:,@%]+$/.test(arg)) {
    return percentEscaped;
  }
  const quoted = `"${percentEscaped.replace(/[\\"`$]/g, (c) => `\\${c}`)}"`;
  return quoted.replace(/\\/g, "\\\\");
}

/**
 * The executable a Linux autostart entry should launch. Inside an AppImage
 * `process.execPath` is a transient `/tmp/.mount_*` path; the runtime exports
 * the real image location as `$APPIMAGE`.
 */
export function linuxLaunchTarget(execPath: string, env: NodeJS.ProcessEnv): string {
  return env.APPIMAGE && env.APPIMAGE.length > 0 ? env.APPIMAGE : execPath;
}

export function linuxAutostartEntry(opts: { name: string; launchTarget: string; iconName: string }): string {
  const exec = [opts.launchTarget, HIDDEN_LAUNCH_ARG].map(quoteDesktopExecArg).join(" ");
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${opts.name}`,
    "Comment=Local MCP gateway",
    `Exec=${exec}`,
    `Icon=${opts.iconName}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    ""
  ].join("\n");
}

export function linuxAutostartDir(env: NodeJS.ProcessEnv, homeDir: string): string {
  const configHome = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME)
    ? env.XDG_CONFIG_HOME
    : path.join(homeDir, ".config");
  return path.join(configHome, "autostart");
}

/** A stable per-user icon location (the AppImage mount and the asar are not stable). */
export function linuxUserIconPath(env: NodeJS.ProcessEnv, homeDir: string, iconName: string): string {
  const dataHome = env.XDG_DATA_HOME && path.isAbsolute(env.XDG_DATA_HOME)
    ? env.XDG_DATA_HOME
    : path.join(homeDir, ".local", "share");
  return path.join(dataHome, "icons", "hicolor", "256x256", "apps", `${iconName}.png`);
}

/**
 * Login item settings for `app.setLoginItemSettings`. Windows needs the same
 * path and args when disabling, or the registry entry is not found. Portable
 * Windows builds run from a temp extraction; electron-builder exposes the
 * real exe as `$PORTABLE_EXECUTABLE_FILE`.
 */
export function loginItemSettingsFor(
  platform: DesktopPlatform,
  enabled: boolean,
  execPath: string,
  env: NodeJS.ProcessEnv
): Electron.Settings | null {
  if (platform === "darwin") {
    return { openAtLogin: enabled, openAsHidden: enabled };
  }
  if (platform === "win32") {
    return {
      openAtLogin: enabled,
      path: env.PORTABLE_EXECUTABLE_FILE || execPath,
      args: [HIDDEN_LAUNCH_ARG]
    };
  }
  return null;
}

/** Whether this launch came from login autostart and should stay hidden in the tray. */
export function isHiddenLaunch(argv: readonly string[], macOpenedAtLogin: boolean): boolean {
  return argv.includes(HIDDEN_LAUNCH_ARG) || argv.includes("--autostart") || macOpenedAtLogin;
}
