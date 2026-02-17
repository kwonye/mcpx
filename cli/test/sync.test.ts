import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig, saveConfig } from "../src/core/config.js";
import { syncAllClients } from "../src/core/sync.js";
import { SecretsManager } from "../src/core/secrets.js";
import { loadManagedIndex } from "../src/core/managed-index.js";
import { getManagedIndexPath } from "../src/core/paths.js";
import { setupTempEnv } from "./helpers.js";

describe("sync engine", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) {
        fn();
      }
    }
  });

  it("keeps unmanaged entries and syncs managed gateway idempotently", () => {
    const env = setupTempEnv("mcpx-sync-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers.circleback = {
      transport: "http",
      url: "https://app.circleback.ai/api/mcp"
    };
    saveConfig(config);

    const vscodePath = path.join(env.root, "Library", "Application Support", "Code", "User", "mcp.json");
    fs.mkdirSync(path.dirname(vscodePath), { recursive: true });
    fs.writeFileSync(
      vscodePath,
      JSON.stringify(
        {
          servers: {
            custom_unmanaged: {
              type: "stdio",
              command: "npx",
              args: ["-y", "@example/server"]
            }
          }
        },
        null,
        2
      )
    );

    const summary1 = syncAllClients(config, new SecretsManager());
    const summary2 = syncAllClients(config, new SecretsManager());

    expect(summary1.hasErrors).toBe(false);
    expect(summary2.hasErrors).toBe(false);

    const finalConfig = JSON.parse(fs.readFileSync(vscodePath, "utf8")) as {
      servers: Record<string, { type: string; url?: string; headers?: Record<string, string> }>;
    };

    expect(finalConfig.servers.custom_unmanaged.type).toBe("stdio");
    expect(finalConfig.servers.circleback.type).toBe("http");
    expect(finalConfig.servers.circleback.url).toContain("127.0.0.1");
    expect(finalConfig.servers.circleback.url).toContain("upstream=circleback");
    expect(typeof finalConfig.servers.circleback.headers?.["x-mcpx-local-token"]).toBe("string");

    const managed = loadManagedIndex(getManagedIndexPath());
    expect(managed.managed.vscode?.entries.circleback).toBeDefined();
  });

  it("reports partial failures but continues syncing other clients", () => {
    const env = setupTempEnv("mcpx-sync-failure-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers.circleback = {
      transport: "http",
      url: "https://app.circleback.ai/api/mcp"
    };
    saveConfig(config);

    const clinePathAsDirectory = path.join(
      env.root,
      "Library",
      "Application Support",
      "Code",
      "User",
      "globalStorage",
      "saoudrizwan.claude-dev",
      "settings",
      "cline_mcp_settings.json"
    );
    fs.mkdirSync(clinePathAsDirectory, { recursive: true });

    const summary = syncAllClients(config, new SecretsManager());

    expect(summary.hasErrors).toBe(true);
    expect(summary.results.some((result) => result.clientId === "cline" && result.status === "ERROR")).toBe(true);
    expect(summary.results.some((result) => result.clientId === "vscode" && result.status === "SYNCED")).toBe(true);
  });

  it("keeps one managed client entry per upstream and prunes removed upstream entries", () => {
    const env = setupTempEnv("mcpx-sync-rename-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers.circleback = {
      transport: "http",
      url: "https://app.circleback.ai/api/mcp"
    };
    config.servers.vercel = {
      transport: "http",
      url: "https://mcp.vercel.com"
    };
    saveConfig(config);

    const vscodePath = path.join(env.root, "Library", "Application Support", "Code", "User", "mcp.json");
    fs.mkdirSync(path.dirname(vscodePath), { recursive: true });

    const first = syncAllClients(config, new SecretsManager());
    expect(first.hasErrors).toBe(false);

    const firstDoc = JSON.parse(fs.readFileSync(vscodePath, "utf8")) as {
      servers: Record<string, { type: string }>;
    };
    expect(firstDoc.servers.circleback?.type).toBe("http");
    expect(firstDoc.servers.vercel?.type).toBe("http");

    delete config.servers.vercel;
    saveConfig(config);

    const second = syncAllClients(config, new SecretsManager());
    expect(second.hasErrors).toBe(false);

    const secondDoc = JSON.parse(fs.readFileSync(vscodePath, "utf8")) as {
      servers: Record<string, { type: string }>;
    };
    expect(secondDoc.servers.circleback?.type).toBe("http");
    expect(secondDoc.servers.vercel).toBeUndefined();

    const managed = loadManagedIndex(getManagedIndexPath());
    expect(Object.keys(managed.managed.vscode?.entries ?? {})).toEqual(["circleback"]);
  });

  it("syncs Claude only at root mcpServers and leaves project mcpServers untouched", () => {
    const env = setupTempEnv("mcpx-sync-claude-root-only-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: "https://mcp.vercel.com"
    };
    saveConfig(config);

    const claudePath = path.join(env.root, ".claude.json");
    const initialClaude = {
      mcpServers: {},
      projects: {
        "/tmp/project-a": {
          mcpServers: {
            project_only: {
              type: "stdio",
              command: "npx",
              args: ["-y", "@example/project-only-mcp"]
            }
          }
        }
      }
    };
    fs.writeFileSync(claudePath, JSON.stringify(initialClaude, null, 2));

    const summary = syncAllClients(config, new SecretsManager());
    expect(summary.hasErrors).toBe(false);
    expect(summary.results.some((result) => result.clientId === "claude" && result.status === "SYNCED")).toBe(true);

    const syncedClaude = JSON.parse(fs.readFileSync(claudePath, "utf8")) as {
      mcpServers: Record<string, { type: string; url?: string }>;
      projects?: Record<string, { mcpServers?: Record<string, { type: string; command?: string }> }>;
    };

    expect(syncedClaude.mcpServers.vercel?.type).toBe("http");
    expect(syncedClaude.mcpServers.vercel?.url).toContain("127.0.0.1");

    const projectServers = syncedClaude.projects?.["/tmp/project-a"]?.mcpServers ?? {};
    expect(projectServers.project_only?.type).toBe("stdio");
    expect(projectServers.vercel).toBeUndefined();
  });
});
