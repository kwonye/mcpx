import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { loadConfig, defaultConfig, saveConfig } from "../src/core/config.js";
import { SecretsManager } from "../src/core/secrets.js";
import { runCli } from "../src/cli.js";
import { setupTempEnv } from "./helpers.js";
import type { HttpServerSpec } from "../src/types.js";

describe("cli config locking", () => {
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

  it("preserves an `auth set` binding racing a concurrent `project remove` on the global config", async () => {
    const env = setupTempEnv("mcpx-cli-lock-authset-");
    cleanups.push(env.restore);
    const originalSkipAutostart = process.env.MCPX_SKIP_DAEMON_AUTOSTART;
    process.env.MCPX_SKIP_DAEMON_AUTOSTART = "1";
    cleanups.push(() => {
      process.env.MCPX_SKIP_DAEMON_AUTOSTART = originalSkipAutostart;
    });

    const projectPath = path.join(env.root, "proj-b");
    fs.mkdirSync(projectPath, { recursive: true });

    const config = defaultConfig();
    config.servers.serverA = { transport: "http", url: "https://a.example.com/mcp" };
    config.servers.control = { transport: "http", url: "https://control.example.com/mcp" };
    config.projects = {
      [projectPath]: { name: "proj-b", path: projectPath, disabledServers: [] }
    };
    saveConfig(config);

    await Promise.all([
      runCli(["node", "mcpx", "auth", "set", "serverA", "--header", "Authorization", "--value", "token-a"]),
      runCli(["node", "mcpx", "project", "remove", projectPath])
    ]);

    const finalConfig = loadConfig();
    // auth set's mutation survived
    const specA = finalConfig.servers.serverA as HttpServerSpec;
    expect(specA.headers?.Authorization).toBe("secret://auth_servera_header_authorization");
    expect(new SecretsManager().getSecret("auth_servera_header_authorization")).toBe("Bearer token-a");
    // project remove's mutation survived
    expect(finalConfig.projects?.[projectPath]).toBeUndefined();
    // unrelated pre-existing data survived
    expect(finalConfig.servers.control).toBeDefined();
  });

  it("preserves both removals when two concurrent `project remove` calls race on the global config", async () => {
    const env = setupTempEnv("mcpx-cli-lock-projectremove-");
    cleanups.push(env.restore);
    const originalSkipAutostart = process.env.MCPX_SKIP_DAEMON_AUTOSTART;
    process.env.MCPX_SKIP_DAEMON_AUTOSTART = "1";
    cleanups.push(() => {
      process.env.MCPX_SKIP_DAEMON_AUTOSTART = originalSkipAutostart;
    });

    // Absolute paths so this doesn't depend on process.cwd(), which can't be
    // isolated per concurrent call within a single test process.
    const projectAPath = path.join(env.root, "proj-a");
    const projectBPath = path.join(env.root, "proj-b");
    fs.mkdirSync(projectAPath, { recursive: true });
    fs.mkdirSync(projectBPath, { recursive: true });

    const config = defaultConfig();
    config.projects = {
      [projectAPath]: { name: "proj-a", path: projectAPath, disabledServers: [] },
      [projectBPath]: { name: "proj-b", path: projectBPath, disabledServers: [] }
    };
    saveConfig(config);

    await Promise.all([
      runCli(["node", "mcpx", "project", "remove", projectAPath]),
      runCli(["node", "mcpx", "project", "remove", projectBPath])
    ]);

    const finalConfig = loadConfig();
    expect(finalConfig.projects?.[projectAPath]).toBeUndefined();
    expect(finalConfig.projects?.[projectBPath]).toBeUndefined();
  });

  it("preserves a newly added server when `sync` races `add` on the global config", async () => {
    const env = setupTempEnv("mcpx-cli-lock-sync-");
    cleanups.push(env.restore);
    const originalSkipAutostart = process.env.MCPX_SKIP_DAEMON_AUTOSTART;
    process.env.MCPX_SKIP_DAEMON_AUTOSTART = "1";
    cleanups.push(() => {
      process.env.MCPX_SKIP_DAEMON_AUTOSTART = originalSkipAutostart;
    });

    const config = defaultConfig();
    config.servers.existing = { transport: "stdio", command: "existing-cmd" };
    saveConfig(config);

    await Promise.all([
      runCli(["node", "mcpx", "add", "new-server", "--transport", "stdio", "sqlite3", "data.db"]),
      runCli(["node", "mcpx", "sync"])
    ]);

    const finalConfig = loadConfig();
    expect(finalConfig.servers.existing).toBeDefined();
    expect(finalConfig.servers["new-server"]).toMatchObject({
      transport: "stdio",
      command: "sqlite3",
      args: ["data.db"]
    });
    // the standalone sync command's persistSyncState mutation also survived
    expect(Object.keys(finalConfig.clients).length).toBeGreaterThan(0);
  });
});
