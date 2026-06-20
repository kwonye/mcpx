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

  it("folds legacy .mcpx.json servers into the global catalog on load", () => {
    const env = setupTempEnv("mcpx-config-merged-");
    cleanups.push(env.restore);

    const configPath = getConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    // Create a dummy project directory
    const projectPath = path.join(env.root, "my-demo-project");
    fs.mkdirSync(projectPath, { recursive: true });

    // 1. Write global config registering the project (project starts with disabledServers=[])
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
          path: projectPath,
          disabledServers: []
        }
      }
    }, null, 2));

    // 2. Write legacy project local .mcpx.json (migration source)
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

    // Global server still present
    expect(merged.servers.globalServer).toMatchObject({
      transport: "http",
      url: "https://global.com",
      enabled: true
    });

    // Legacy project server is now folded into the global catalog under its plain name
    // (no namespace prefix), with cwd defaulted to the project path
    expect(merged.servers["projectServer"]).toMatchObject({
      transport: "stdio",
      command: "node",
      args: ["server.js"],
      cwd: projectPath,
      enabled: true
    });

    // The old namespaced form no longer exists
    expect(merged.servers["custom-project-name.projectServer"]).toBeUndefined();
    expect(merged.servers["my-demo-project.projectServer"]).toBeUndefined();

    // Migration is idempotent: if globalServer is already in catalog, it is not overwritten
    const merged2 = loadMergedConfig();
    expect(merged2.servers.globalServer.enabled).toBe(true);
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

    // Create a .mcpx.json so project detection works
    const localConfigPath = path.join(projectPath, ".mcpx.json");
    fs.writeFileSync(localConfigPath, JSON.stringify({
      name: "active-project",
      servers: {}
    }, null, 2));

    const { resolveActiveConfig } = require("../src/core/config.js");

    // Global context: always returns global config
    const globalContext = resolveActiveConfig({ global: true });
    expect(globalContext.type).toBe("global");
    expect(globalContext.config.servers.globalOne).toBeDefined();

    // Project context: type is "project", projectPath is set, but config is still global
    const originalCwd = process.cwd;
    process.cwd = () => projectPath;
    try {
      const localContext = resolveActiveConfig({ local: true });
      expect(localContext.type).toBe("project");
      expect(localContext.projectPath).toBe(projectPath);
      // In the new model, the project context still reads global catalog
      expect(localContext.config.servers.globalOne).toBeDefined();

      // save() writes to the global config
      localContext.config.servers.addedGlobally = {
        transport: "http",
        url: "https://new.com",
        enabled: true
      };
      localContext.save();

      const savedGlobal = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(savedGlobal.servers.addedGlobally).toBeDefined();
    } finally {
      process.cwd = originalCwd;
    }
  });
});
