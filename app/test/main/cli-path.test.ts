import { describe, expect, it } from "vitest";
import path from "node:path";
import { resolveCliDaemonPath } from "../../src/main/cli-path";

type PathApi = typeof path.posix;

function expectCli(resourcesPath: string | undefined, appPath: string, expected: string, paths: PathApi): void {
  expect(resolveCliDaemonPath(resourcesPath, appPath, (candidate) => candidate === expected, paths)).toBe(expected);
}

describe("resolveCliDaemonPath", () => {
  it("uses the packaged CLI from resources", () => {
    const posixResources = "/Applications/mcpx.app/Contents/Resources";
    expectCli(posixResources, "/Applications/mcpx.app", path.posix.join(posixResources, "cli", "dist", "cli.js"), path.posix);

    const winResources = "C:\\Program Files\\mcpx\\resources";
    expectCli(winResources, "C:\\Program Files\\mcpx\\resources\\app.asar", path.win32.join(winResources, "cli", "dist", "cli.js"), path.win32);
  });

  it("finds the repository CLI from the Electron E2E app path", () => {
    expectCli(undefined, "/workspace/mcpx/app/out/main", "/workspace/mcpx/cli/dist/cli.js", path.posix);
    expectCli(undefined, "D:\\workspace\\mcpx\\app\\out\\main", "D:\\workspace\\mcpx\\cli\\dist\\cli.js", path.win32);
    // Electron may hand back a drive path with forward slashes. win32.resolve normalizes them.
    expectCli(undefined, "D:/workspace/mcpx/app/out/main", "D:\\workspace\\mcpx\\cli\\dist\\cli.js", path.win32);
  });

  it("resolves a leading-slash app path with the host path module", () => {
    const appPath = "/workspace/mcpx/app/out/main";
    const expected = path.resolve("/workspace/mcpx/cli/dist/cli.js");
    expect(resolveCliDaemonPath(undefined, appPath, (candidate) => candidate === expected)).toBe(expected);
  });

  it("fails before spawning Electron when no CLI build exists", () => {
    expect(() => resolveCliDaemonPath("/missing/resources", "/workspace/mcpx/app/out/main", () => false, path.posix)).toThrow("Unable to locate the mcpx CLI");
    expect(() => resolveCliDaemonPath("C:\\missing\\resources", "D:\\workspace\\mcpx\\app\\out\\main", () => false, path.win32)).toThrow("Unable to locate the mcpx CLI");
  });
});
