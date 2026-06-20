import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { loadConfig, defaultConfig, saveConfig } from "../src/core/config.js";
import { runCli } from "../src/cli.js";
import { setupTempEnv } from "./helpers.js";

describe("cli enable/disable commands", () => {
  const cleanups: Array<() => void> = [];
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "darwin" });
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it("disables and re-enables servers while syncing the managed client entries", async () => {
    const env = setupTempEnv("mcpx-cli-toggle-");
    cleanups.push(env.restore);
    const originalSkipAutostart = process.env.MCPX_SKIP_DAEMON_AUTOSTART;
    process.env.MCPX_SKIP_DAEMON_AUTOSTART = "1";
    cleanups.push(() => {
      process.env.MCPX_SKIP_DAEMON_AUTOSTART = originalSkipAutostart;
    });

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: "https://mcp.vercel.com"
    };
    saveConfig(config);

    await runCli(["node", "mcpx", "disable", "vercel"]);

    expect(loadConfig().servers.vercel?.enabled).toBe(false);

    // VS Code omits disabled entries entirely — no disabled field written
    const vscodePath = path.join(env.root, "Library", "Application Support", "Code", "User", "mcp.json");
    const disabledDoc = JSON.parse(fs.readFileSync(vscodePath, "utf8")) as {
      servers: Record<string, { disabled?: boolean; type?: string }>;
    };
    expect(disabledDoc.servers["vercel (mcpx)"]).toBeUndefined();

    await runCli(["node", "mcpx", "enable", "vercel"]);

    expect(loadConfig().servers.vercel?.enabled).toBe(true);

    const enabledDoc = JSON.parse(fs.readFileSync(vscodePath, "utf8")) as {
      servers: Record<string, { disabled?: boolean; type?: string }>;
    };
    expect(enabledDoc.servers["vercel (mcpx)"]?.type).toBe("http");
    expect(enabledDoc.servers["vercel (mcpx)"]?.disabled).toBeUndefined();
  });
});

describe("cli project-based configurations", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it("initializes a project and adds/removes servers from the global catalog", async () => {
    const env = setupTempEnv("mcpx-cli-project-");
    cleanups.push(env.restore);
    const originalSkipAutostart = process.env.MCPX_SKIP_DAEMON_AUTOSTART;
    process.env.MCPX_SKIP_DAEMON_AUTOSTART = "1";
    cleanups.push(() => {
      process.env.MCPX_SKIP_DAEMON_AUTOSTART = originalSkipAutostart;
    });

    // Create a dummy project directory
    const projectPath = path.join(env.root, "demo-project");
    fs.mkdirSync(projectPath, { recursive: true });

    // Mock process.cwd() to point to our demo-project
    const originalCwd = process.cwd;
    process.cwd = () => projectPath;

    try {
      // 1. Run "mcpx project init my-cool-project"
      // The CLI still writes a .mcpx.json marker for backward compat, but servers go to global catalog.
      await runCli(["node", "mcpx", "project", "init", "my-cool-project"]);

      // Project is registered globally
      const globalConfig = loadConfig();
      expect(globalConfig.projects[projectPath]).toMatchObject({
        name: "my-cool-project",
        path: projectPath
      });

      // 2. Add an MCP server — in the new unified-catalog model, this goes to the global catalog
      await runCli(["node", "mcpx", "add", "local-sqlite", "--transport", "stdio", "sqlite3", "data.db"]);

      const globalConfigAfterAdd = loadConfig();
      expect(globalConfigAfterAdd.servers["local-sqlite"]).toMatchObject({
        transport: "stdio",
        command: "sqlite3",
        args: ["data.db"],
        enabled: true
      });

      // 3. List the servers — server appears in global catalog
      let listOutput = "";
      const originalStdoutWrite = process.stdout.write;
      process.stdout.write = (chunk: any) => {
        listOutput += chunk.toString();
        return true;
      };
      try {
        await runCli(["node", "mcpx", "list"]);
      } finally {
        process.stdout.write = originalStdoutWrite;
      }
      expect(listOutput).toContain("local-sqlite");

      // 4. List registered projects
      let projectListOutput = "";
      process.stdout.write = (chunk: any) => {
        projectListOutput += chunk.toString();
        return true;
      };
      try {
        await runCli(["node", "mcpx", "project", "list"]);
      } finally {
        process.stdout.write = originalStdoutWrite;
      }
      expect(projectListOutput).toContain("my-cool-project");
      expect(projectListOutput).toContain(projectPath);

      // 5. Remove the server — removes from global catalog
      await runCli(["node", "mcpx", "remove", "local-sqlite"]);
      const globalConfigAfterRemove = loadConfig();
      expect(globalConfigAfterRemove.servers["local-sqlite"]).toBeUndefined();

      // 6. Unregister the project globally
      await runCli(["node", "mcpx", "project", "remove", projectPath]);
      const globalConfigAfterUnregister = loadConfig();
      expect(globalConfigAfterUnregister.projects[projectPath]).toBeUndefined();
    } finally {
      process.cwd = originalCwd;
    }
  });
});
