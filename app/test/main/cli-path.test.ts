import { describe, expect, it } from "vitest";
import path from "node:path";
import { resolveCliDaemonPath } from "../../src/main/cli-path";

describe("resolveCliDaemonPath", () => {
  it("uses the packaged CLI from resources", () => {
    const expected = path.join("/Applications/mcpx.app/Contents/Resources", "cli", "dist", "cli.js");
    expect(resolveCliDaemonPath("/Applications/mcpx.app/Contents/Resources", "/Applications/mcpx.app", (candidate) => candidate === expected)).toBe(expected);
  });

  it("finds the repository CLI from the Electron E2E app path", () => {
    const appPath = "/workspace/mcpx/app/out/main";
    const expected = "/workspace/mcpx/cli/dist/cli.js";
    expect(resolveCliDaemonPath(undefined, appPath, (candidate) => candidate === expected)).toBe(expected);
  });

  it("fails before spawning Electron when no CLI build exists", () => {
    expect(() => resolveCliDaemonPath("/missing/resources", "/workspace/mcpx/app/out/main", () => false)).toThrow("Unable to locate the mcpx CLI");
  });
});
