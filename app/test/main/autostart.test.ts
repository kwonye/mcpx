import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  HIDDEN_LAUNCH_ARG,
  linuxAutostartDir,
  linuxAutostartEntry,
  linuxLaunchTarget,
  linuxUserIconPath,
  loginItemSettingsFor,
  quoteDesktopExecArg
} from "../../src/main/platform/autostart";

function execLine(entry: string): string {
  return entry.split("\n").find((line) => line.startsWith("Exec="))!;
}

describe("Linux autostart entry", () => {
  it("launches the installed binary hidden", () => {
    const entry = linuxAutostartEntry({ name: "mcpx", launchTarget: "/opt/mcpx/mcpx-desktop", iconName: "mcpx" });

    expect(execLine(entry)).toBe("Exec=/opt/mcpx/mcpx-desktop --hidden");
    expect(entry).toContain("[Desktop Entry]\nType=Application\nName=mcpx\n");
    expect(entry).toContain("Icon=mcpx\n");
    expect(entry).toContain("X-GNOME-Autostart-enabled=true");
    expect(entry).not.toContain("app.asar");
  });

  it("uses $APPIMAGE instead of the transient AppImage mount", () => {
    const target = linuxLaunchTarget("/tmp/.mount_mcpxAbC/mcpx-desktop", { APPIMAGE: "/home/me/Apps/mcpx-1.2.3.AppImage" });
    const entry = linuxAutostartEntry({ name: "mcpx", launchTarget: target, iconName: "mcpx" });

    expect(execLine(entry)).toBe("Exec=/home/me/Apps/mcpx-1.2.3.AppImage --hidden");
    expect(linuxLaunchTarget("/opt/mcpx/mcpx-desktop", {})).toBe("/opt/mcpx/mcpx-desktop");
    expect(linuxLaunchTarget("/opt/mcpx/mcpx-desktop", { APPIMAGE: "" })).toBe("/opt/mcpx/mcpx-desktop");
  });

  it("quotes paths with spaces", () => {
    const entry = linuxAutostartEntry({ name: "mcpx", launchTarget: "/home/me/My Apps/mcpx.AppImage", iconName: "mcpx" });

    expect(execLine(entry)).toBe('Exec="/home/me/My Apps/mcpx.AppImage" --hidden');
  });

  it("escapes reserved characters per the Desktop Entry spec", () => {
    expect(quoteDesktopExecArg("/a/b")).toBe("/a/b");
    expect(quoteDesktopExecArg("/a/100%")).toBe("/a/100%%");
    expect(quoteDesktopExecArg('/a/"q"')).toBe('"/a/\\\\"q\\\\""');
    expect(quoteDesktopExecArg("/a/$HOME")).toBe('"/a/\\\\$HOME"');
    expect(quoteDesktopExecArg("/a/`x`")).toBe('"/a/\\\\`x\\\\`"');
    expect(quoteDesktopExecArg("/a\\b")).toBe('"/a\\\\\\\\b"');
  });

  it("honours XDG directories and falls back to ~/.config and ~/.local/share", () => {
    expect(linuxAutostartDir({}, "/home/me")).toBe(path.join("/home/me", ".config", "autostart"));
    expect(linuxAutostartDir({ XDG_CONFIG_HOME: "/xdg/config" }, "/home/me")).toBe(path.join("/xdg/config", "autostart"));
    expect(linuxAutostartDir({ XDG_CONFIG_HOME: "relative" }, "/home/me")).toBe(path.join("/home/me", ".config", "autostart"));
    expect(linuxUserIconPath({}, "/home/me", "mcpx")).toBe(
      path.join("/home/me", ".local", "share", "icons", "hicolor", "256x256", "apps", "mcpx.png")
    );
  });
});

describe("login item settings", () => {
  it("macOS keeps openAtLogin + openAsHidden", () => {
    expect(loginItemSettingsFor("darwin", true, "/Applications/mcpx.app/Contents/MacOS/mcpx", {})).toEqual({
      openAtLogin: true,
      openAsHidden: true
    });
  });

  it("Windows launches the exe with --hidden, and uses the same path/args to disable", () => {
    const exe = "C:\\Users\\Me\\AppData\\Local\\Programs\\mcpx\\mcpx.exe";
    expect(loginItemSettingsFor("win32", true, exe, {})).toEqual({ openAtLogin: true, path: exe, args: [HIDDEN_LAUNCH_ARG] });
    expect(loginItemSettingsFor("win32", false, exe, {})).toEqual({ openAtLogin: false, path: exe, args: [HIDDEN_LAUNCH_ARG] });
  });

  it("Windows portable builds register the real exe, not the temp extraction", () => {
    const settings = loginItemSettingsFor("win32", true, "C:\\Temp\\2abc\\mcpx.exe", {
      PORTABLE_EXECUTABLE_FILE: "D:\\Tools\\mcpx 1.2.3.exe"
    });
    expect(settings?.path).toBe("D:\\Tools\\mcpx 1.2.3.exe");
  });

  it("Linux uses the autostart file instead", () => {
    expect(loginItemSettingsFor("linux", true, "/opt/mcpx/mcpx", {})).toBeNull();
  });
});
