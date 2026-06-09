import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { loadConfig } from "../src/core/config.js";
import { getConfigPath } from "../src/core/paths.js";
import { setupTempEnv } from "./helpers.js";

describe("config loading", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      fn?.();
    }
  });

  it("defaults legacy servers to enabled when the field is absent", () => {
    const env = setupTempEnv("mcpx-config-");
    cleanups.push(env.restore);

    const configPath = getConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      schemaVersion: 1,
      gateway: {
        port: 37373,
        tokenRef: "secret://local_gateway_token",
        autoStart: true
      },
      servers: {
        vercel: {
          transport: "http",
          url: "https://mcp.vercel.com"
        }
      },
      clients: {}
    }, null, 2));

    const config = loadConfig();

    expect(config.servers.vercel).toMatchObject({
      transport: "http",
      url: "https://mcp.vercel.com",
      enabled: true
    });
  });

  it("repairs quoted URL stdio servers into HTTP servers", () => {
    const env = setupTempEnv("mcpx-config-repair-url-");
    cleanups.push(env.restore);

    const configPath = getConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      schemaVersion: 1,
      gateway: { port: 37373, tokenRef: "secret://local_gateway_token", autoStart: true },
      servers: {
        supabase: {
          transport: "stdio",
          command: "'https://mcp.supabase.com/mcp'"
        }
      },
      clients: {}
    }, null, 2));

    expect(loadConfig().servers.supabase).toEqual({
      transport: "http",
      url: "https://mcp.supabase.com/mcp",
      enabled: true
    });
  });

  it("repairs command strings with spaces into command and args", () => {
    const env = setupTempEnv("mcpx-config-repair-command-");
    cleanups.push(env.restore);

    const configPath = getConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      schemaVersion: 1,
      gateway: { port: 37373, tokenRef: "secret://local_gateway_token", autoStart: true },
      servers: {
        Railway: {
          transport: "stdio",
          command: "npx @railway/mcp-server",
          args: ["--verbose"]
        }
      },
      clients: {}
    }, null, 2));

    expect(loadConfig().servers.Railway).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["@railway/mcp-server", "--verbose"],
      enabled: true
    });
  });

  it("drops client-internal app bundle stdio servers on load", () => {
    const env = setupTempEnv("mcpx-config-repair-internal-");
    cleanups.push(env.restore);

    const configPath = getConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      schemaVersion: 1,
      gateway: { port: 37373, tokenRef: "secret://local_gateway_token", autoStart: true },
      servers: {
        node_repl: {
          transport: "stdio",
          command: "/Applications/Codex.app/Contents/Resources/node"
        }
      },
      clients: {}
    }, null, 2));

    expect(loadConfig().servers.node_repl).toBeUndefined();
  });
});

describe("project config and merging", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      fn?.();
    }
  });

  it("loads and merges project-scoped configs", () => {
    const env = setupTempEnv("mcpx-config-merged-");
    cleanups.push(env.restore);

    const configPath = getConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    // Create a dummy project directory
    const projectPath = path.join(env.root, "my-demo-project");
    fs.mkdirSync(projectPath, { recursive: true });

    // 1. Write global config registering the project
    fs.writeFileSync(configPath, JSON.stringify({
      schemaVersion: 1,
      gateway: { port: 37373, tokenRef: "secret://local_gateway_token", autoStart: true },
      servers: {
        globalServer: {
          transport: "http",
          url: "https://global.com"
        }
      },
      clients: {},
      projects: {
        [projectPath]: {
          name: "my-demo-project",
          path: projectPath
        }
      }
    }, null, 2));

    // 2. Write project local .mcpx.json config
    const localConfigPath = path.join(projectPath, ".mcpx.json");
    fs.writeFileSync(localConfigPath, JSON.stringify({
      name: "custom-project-name",
      servers: {
        projectServer: {
          transport: "stdio",
          command: "node",
          args: ["server.js"]
        }
      }
    }, null, 2));

    // 3. Load merged config
    const { loadMergedConfig } = require("../src/core/config.js");
    const merged = loadMergedConfig();

    // Verify global server is present
    expect(merged.servers.globalServer).toMatchObject({
      transport: "http",
      url: "https://global.com",
      enabled: true
    });

    // Verify project server is namespaced and has CWD defaulted to projectPath
    expect(merged.servers["custom-project-name.projectServer"]).toMatchObject({
      transport: "stdio",
      command: "node",
      args: ["server.js"],
      cwd: projectPath,
      enabled: true
    });
  });

  it("resolves active config context correctly", () => {
    const env = setupTempEnv("mcpx-config-active-");
    cleanups.push(env.restore);

    const configPath = getConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    // Create project path
    const projectPath = path.join(env.root, "active-project");
    fs.mkdirSync(projectPath, { recursive: true });

    fs.writeFileSync(configPath, JSON.stringify({
      schemaVersion: 1,
      servers: {
        globalOne: { transport: "http", url: "https://global.com" }
      },
      projects: {}
    }, null, 2));

    const localConfigPath = path.join(projectPath, ".mcpx.json");
    fs.writeFileSync(localConfigPath, JSON.stringify({
      name: "active-project",
      servers: {
        localOne: { transport: "http", url: "https://local.com" }
      }
    }, null, 2));

    const { resolveActiveConfig } = require("../src/core/config.js");

    // Force global context
    const globalContext = resolveActiveConfig({ global: true });
    expect(globalContext.type).toBe("global");
    expect(globalContext.config.servers.globalOne).toBeDefined();
    expect(globalContext.config.servers.localOne).toBeUndefined();

    // Force local context using process.cwd() mock
    const originalCwd = process.cwd;
    process.cwd = () => projectPath;
    try {
      const localContext = resolveActiveConfig({ local: true });
      expect(localContext.type).toBe("project");
      expect(localContext.projectPath).toBe(projectPath);
      expect(localContext.config.servers.localOne).toBeDefined();
      expect(localContext.config.servers.globalOne).toBeUndefined();

      // Test save callback in project context
      localContext.config.servers.localTwo = {
        transport: "http",
        url: "https://local2.com",
        enabled: true
      };
      localContext.save();

      const savedLocal = JSON.parse(fs.readFileSync(localConfigPath, "utf8"));
      expect(savedLocal.servers.localTwo).toBeDefined();
    } finally {
      process.cwd = originalCwd;
    }
  });
});
