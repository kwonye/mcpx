import { describe, expect, it } from "bun:test";
import { ensureWindowsExecutablePath, pluginHostBaseEnv } from "../src/core/plugin-host.js";

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

  it("preserves a caller-provided PATHEXT", () => {
    const env = pluginHostBaseEnv({
      PATH: "C:\\Windows\\system32",
      PATHEXT: ".EXE"
    }, "win32");

    expect(env.PATHEXT).toBe(".EXE");
  });
});
