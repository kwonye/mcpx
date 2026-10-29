import path from "node:path";
import { describe, expect, it } from "bun:test";
import { ensureWindowsExecutablePath, pluginHostBaseEnv, resolveSpawnCommand } from "../src/core/plugin-host.js";
import { resolveLocalCliLaunch } from "../src/core/runtime-entry.js";

describe("plugin host environment", () => {
  it("keeps POSIX launch variables and drops everything else", () => {
    const env = pluginHostBaseEnv({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      TMPDIR: "/tmp",
      LANG: "en_US.UTF-8",
      SHELL: "/bin/sh",
      POSTHOG_API_KEY: "secret",
      AWS_SECRET_ACCESS_KEY: "secret"
    }, "linux");

    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      TMPDIR: "/tmp",
      LANG: "en_US.UTF-8",
      SHELL: "/bin/sh"
    });
  });

  it("supplies PATHEXT and SystemRoot so Windows can start node.exe", () => {
    const env = pluginHostBaseEnv({
      PATH: "C:\\Program Files\\nodejs;C:\\Windows\\system32",
      SYSTEMROOT: "C:\\Windows",
      SYSTEMDRIVE: "C:",
      TEMP: "C:\\Temp",
      USERPROFILE: "C:\\Users\\runner",
      POSTHOG_API_KEY: "secret"
    }, "win32");

    expect(env.PATH).toContain("nodejs");
    expect(env.SYSTEMROOT).toBe("C:\\Windows");
    expect(env.SYSTEMDRIVE).toBe("C:");
    expect(env.TEMP).toBe("C:\\Temp");
    expect(env.USERPROFILE).toBe("C:\\Users\\runner");
    expect(env.PATHEXT).toContain(".EXE");
    expect(env.POSTHOG_API_KEY).toBeUndefined();
  });

  it("sets PATHEXT on the parent process so Windows can resolve node.exe", () => {
    const parent: NodeJS.ProcessEnv = { PATH: "C:\\Windows\\system32" };
    ensureWindowsExecutablePath(parent, "win32");
    expect(parent.PATHEXT).toContain(".EXE");

    const already: NodeJS.ProcessEnv = { PATHEXT: ".EXE" };
    ensureWindowsExecutablePath(already, "win32");
    expect(already.PATHEXT).toBe(".EXE");

    const posix: NodeJS.ProcessEnv = {};
    ensureWindowsExecutablePath(posix, "linux");
    expect(posix.PATHEXT).toBeUndefined();
  });

  it("resolves extensionless Windows commands to an absolute executable", () => {
    const env = {
      PATH: "C:\\Windows\\system32;C:\\Program Files\\nodejs",
      PATHEXT: ".COM;.EXE"
    };
    const seen: string[] = [];
    const resolved = resolveSpawnCommand("node", env, "win32", (candidate) => {
      seen.push(candidate);
      return candidate === "C:\\Program Files\\nodejs\\node.EXE";
    });

    expect(resolved).toBe("C:\\Program Files\\nodejs\\node.EXE");
    expect(seen).toContain("C:\\Windows\\system32\\node.COM");
    expect(seen).toContain("C:\\Program Files\\nodejs\\node.EXE");
  });

  it("leaves POSIX commands and Windows paths that already have an extension alone", () => {
    expect(resolveSpawnCommand("node", { PATH: "/usr/bin" }, "linux", () => true)).toBe("node");
    expect(resolveSpawnCommand("C:\\Program Files\\nodejs\\node.exe", { PATH: "C:\\Windows" }, "win32", () => {
      throw new Error("exists should not be called");
    })).toBe("C:\\Program Files\\nodejs\\node.exe");
  });

  it("runs a Windows source checkout through node and the built CLI", () => {
    const here = path.join("C:\\src", "cli", "src", "core");
    const launch = resolveLocalCliLaunch({
      here,
      entry: path.join("C:\\src", "cli", "src", "cli.ts"),
      execPath: "C:\\bun\\bun.exe",
      platform: "win32",
      bun: true,
      electron: false,
      distCliExists: true
    });

    expect(launch.command).toBe("node");
    expect(launch.script).toBe(path.win32.join("C:\\src", "cli", "dist", "cli.js"));
  });

  it("keeps bun for source checkouts that are not Windows", () => {
    const entry = "/src/cli/src/cli.ts";
    const launch = resolveLocalCliLaunch({
      here: "/src/cli/src/core",
      entry,
      execPath: "/usr/bin/bun",
      platform: "linux",
      bun: true,
      electron: false,
      distCliExists: true
    });

    expect(launch).toEqual({ command: "/usr/bin/bun", script: entry });
  });

  it("preserves a caller-provided PATHEXT", () => {
    const env = pluginHostBaseEnv({
      PATH: "C:\\Windows\\system32",
      PATHEXT: ".EXE"
    }, "win32");

    expect(env.PATHEXT).toBe(".EXE");
  });
});
