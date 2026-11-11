import fs from "node:fs";
import path from "node:path";
import { homeDir } from "../core/paths.js";

/**
 * Everything client path resolution and install detection depends on. Passed in
 * explicitly so detection can be exercised for any OS from any OS in tests.
 */
export interface HostContext {
  platform: NodeJS.Platform;
  home: string;
  env: Record<string, string | undefined>;
  exists: (filePath: string) => boolean;
}

export function currentHost(overrides: Partial<HostContext> = {}): HostContext {
  return {
    platform: process.platform,
    home: homeDir(),
    env: process.env,
    exists: (filePath) => fs.existsSync(filePath),
    ...overrides
  };
}

function pathApi(ctx: HostContext): typeof path.posix {
  return ctx.platform === "win32" ? path.win32 : path.posix;
}

export function joinPath(ctx: HostContext, ...parts: string[]): string {
  return pathApi(ctx).join(...parts);
}

export function homePath(ctx: HostContext, ...parts: string[]): string {
  return joinPath(ctx, ctx.home, ...parts);
}

function envValue(ctx: HostContext, name: string): string | undefined {
  const value = ctx.env[name];
  return value && value.trim().length > 0 ? value : undefined;
}

/** `$XDG_CONFIG_HOME` or `~/.config` (used by XDG-style tools on every OS, e.g. OpenCode). */
export function xdgConfigDir(ctx: HostContext): string {
  return envValue(ctx, "XDG_CONFIG_HOME") ?? homePath(ctx, ".config");
}

/** Electron/VS Code-style per-user app data: `~/Library/Application Support`, `%APPDATA%`, or XDG config. */
export function appDataDir(ctx: HostContext): string {
  if (ctx.platform === "darwin") {
    return homePath(ctx, "Library", "Application Support");
  }
  if (ctx.platform === "win32") {
    return envValue(ctx, "APPDATA") ?? homePath(ctx, "AppData", "Roaming");
  }
  return xdgConfigDir(ctx);
}

/** `%LOCALAPPDATA%` (Windows only; undefined elsewhere). */
export function localAppDataDir(ctx: HostContext): string | undefined {
  if (ctx.platform !== "win32") return undefined;
  return envValue(ctx, "LOCALAPPDATA") ?? homePath(ctx, "AppData", "Local");
}

/** Per-user and system application bundle locations on macOS. */
export function macApps(ctx: HostContext, ...bundles: string[]): string[] {
  if (ctx.platform !== "darwin") return [];
  return bundles.flatMap((bundle) => [joinPath(ctx, "/Applications", bundle), homePath(ctx, "Applications", bundle)]);
}

/** Install directories under `%LOCALAPPDATA%\Programs` (the default per-user installer target on Windows). */
export function windowsPrograms(ctx: HostContext, ...dirs: string[]): string[] {
  const local = localAppDataDir(ctx);
  if (!local) return [];
  return dirs.map((dir) => joinPath(ctx, local, "Programs", dir));
}

/** Resolve an executable on PATH in-process (no `which`/`where`), honouring PATHEXT on Windows. */
export function findOnPath(ctx: HostContext, name: string): string | null {
  const isWindows = ctx.platform === "win32";
  const rawPath = (isWindows ? ctx.env.Path ?? ctx.env.PATH : ctx.env.PATH) ?? "";
  const extensions = isWindows
    ? (envValue(ctx, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  for (const dir of rawPath.split(isWindows ? ";" : ":")) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = joinPath(ctx, dir, `${name}${extension.toLowerCase()}`);
      if (ctx.exists(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}
