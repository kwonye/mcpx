import fs from "node:fs";
import path from "node:path";
import { parse, stringify } from "@iarna/toml";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { defaultConfig, saveConfig } from "../src/core/config.js";
import { syncAllClients } from "../src/core/sync.js";
import { SecretsManager } from "../src/core/secrets.js";
import { loadManagedIndex } from "../src/core/managed-index.js";
import { getManagedIndexPath } from "../src/core/paths.js";
import { setupTempEnv } from "./helpers.js";

describe("sync engine", () => {
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
      const fn = cleanups.pop();
      if (fn) {
        fn();
      }
    }
  });

  it("adopts unmanaged entries and syncs managed gateway idempotently", () => {
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

    expect(finalConfig.servers.custom_unmanaged).toBeUndefined();
    expect(finalConfig.servers["custom_unmanaged (mcpx)"].type).toBe("http");
    expect(finalConfig.servers["circleback (mcpx)"].type).toBe("http");
    expect(finalConfig.servers["circleback (mcpx)"].url).toContain("127.0.0.1");
    expect(finalConfig.servers["circleback (mcpx)"].url).toContain("upstream=circleback");
    expect(typeof finalConfig.servers["circleback (mcpx)"].headers?.["Authorization"]).toBe("string");
    expect(config.servers.custom_unmanaged).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@example/server"],
      env: undefined,
      cwd: undefined,
      enabled: true
    });

    const managed = loadManagedIndex(getManagedIndexPath());
    expect(managed.managed.vscode?.entries["circleback (mcpx)"]).toBeDefined();
    expect(managed.managed.vscode?.entries["custom_unmanaged (mcpx)"]).toBeDefined();
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
    expect(firstDoc.servers["circleback (mcpx)"]?.type).toBe("http");
    expect(firstDoc.servers["vercel (mcpx)"]?.type).toBe("http");

    delete config.servers.vercel;
    saveConfig(config);

    const second = syncAllClients(config, new SecretsManager());
    expect(second.hasErrors).toBe(false);

    const secondDoc = JSON.parse(fs.readFileSync(vscodePath, "utf8")) as {
      servers: Record<string, { type: string }>;
    };
    expect(secondDoc.servers["circleback (mcpx)"]?.type).toBe("http");
    expect(secondDoc.servers["vercel (mcpx)"]).toBeUndefined();

    const managed = loadManagedIndex(getManagedIndexPath());
    expect(Object.keys(managed.managed.vscode?.entries ?? {})).toEqual(["circleback (mcpx)"]);
  });

  it("prunes orphaned (mcpx) entries not tracked in the managed index", () => {
    const env = setupTempEnv("mcpx-sync-orphaned-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: "https://mcp.vercel.com"
    };
    saveConfig(config);

    const vscodePath = path.join(env.root, "Library", "Application Support", "Code", "User", "mcp.json");
    fs.mkdirSync(path.dirname(vscodePath), { recursive: true });
    fs.writeFileSync(
      vscodePath,
      JSON.stringify({
        servers: {
          "alive (mcpx)": {
            type: "http",
            url: "http://127.0.0.1:37373/mcp?upstream=alive"
          },
          "ghost (mcpx)": {
            type: "http",
            url: "http://127.0.0.1:37373/mcp?upstream=ghost"
          },
          unmanaged: {
            type: "stdio",
            command: "npx",
            args: ["-y", "@example/unmanaged"]
          }
        }
      }, null, 2)
    );

    const summary = syncAllClients(config, new SecretsManager());
    expect(summary.hasErrors).toBe(false);

    const synced = JSON.parse(fs.readFileSync(vscodePath, "utf8")) as {
      servers: Record<string, unknown>;
    };

    expect(synced.servers["vercel (mcpx)"]).toBeDefined();
    expect(synced.servers["ghost (mcpx)"]).toBeUndefined();
    expect(synced.servers.unmanaged).toBeUndefined();
    expect(synced.servers["unmanaged (mcpx)"]).toBeDefined();
  });

  it("syncs Claude only at root mcpServers and leaves unregistered project mcpServers untouched", () => {
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
      projects?: Record<string, { mcpServers?: Record<string, { type: string; command?: string }>; disabledMcpServers?: string[] }>;
    };

    // Globally-enabled vercel is at root
    expect(syncedClaude.mcpServers["vercel (mcpx)"]?.type).toBe("http");
    expect(syncedClaude.mcpServers["vercel (mcpx)"]?.url).toContain("127.0.0.1");

    // Unregistered project mcpServers block is untouched
    const projectServers = syncedClaude.projects?.["/tmp/project-a"]?.mcpServers ?? {};
    expect(projectServers.project_only?.type).toBe("stdio");
    expect(projectServers["vercel (mcpx)"]).toBeUndefined();

    // Unregistered project does NOT get managed names in its disabledMcpServers
    expect(syncedClaude.projects?.["/tmp/project-a"]?.disabledMcpServers).toBeUndefined();
  });

  it("writes per-project disabledMcpServers for registered projects", () => {
    const env = setupTempEnv("mcpx-sync-claude-project-scope-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers.vercel = { transport: "http", url: "https://mcp.vercel.com", enabled: true };
    config.servers.context7 = { transport: "http", url: "https://context7.com/mcp", enabled: true };
    // Register a project with context7 disabled for it
    config.projects = {
      "/tmp/my-project": {
        name: "my-project",
        path: "/tmp/my-project",
        disabledServers: ["context7"]
      }
    };
    saveConfig(config);

    const claudePath = path.join(env.root, ".claude.json");
    fs.writeFileSync(claudePath, JSON.stringify({ mcpServers: {} }, null, 2));

    const summary = syncAllClients(config, new SecretsManager());
    expect(summary.hasErrors).toBe(false);

    const syncedClaude = JSON.parse(fs.readFileSync(claudePath, "utf8")) as {
      mcpServers: Record<string, unknown>;
      projects?: Record<string, { disabledMcpServers?: string[] }>;
    };

    // Both servers at root (global profile)
    expect(syncedClaude.mcpServers["vercel (mcpx)"]).toBeDefined();
    expect(syncedClaude.mcpServers["context7 (mcpx)"]).toBeDefined();

    // Registered project has context7 in its disabled list but NOT vercel
    const projectEntry = syncedClaude.projects?.["/tmp/my-project"];
    expect(projectEntry?.disabledMcpServers).toContain("context7 (mcpx)");
    expect(projectEntry?.disabledMcpServers).not.toContain("vercel (mcpx)");
  });

  it("strips stale managed names from previously-synced project entries", () => {
    const env = setupTempEnv("mcpx-sync-claude-project-stale-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers.vercel = { transport: "http", url: "https://mcp.vercel.com", enabled: true };
    // No registered projects (previously had one; now unregistered)
    saveConfig(config);

    const claudePath = path.join(env.root, ".claude.json");
    // Pre-existing Claude project entry with a stale managed disabled name from before
    fs.writeFileSync(claudePath, JSON.stringify({
      mcpServers: {},
      projects: {
        "/tmp/old-project": {
          disabledMcpServers: ["vercel (mcpx)", "my-non-managed-entry"]
        }
      }
    }, null, 2));

    syncAllClients(config, new SecretsManager());

    const syncedClaude = JSON.parse(fs.readFileSync(claudePath, "utf8")) as {
      projects?: Record<string, { disabledMcpServers?: string[] }>;
    };

    // The managed name is stripped since project is no longer registered
    expect(syncedClaude.projects?.["/tmp/old-project"]?.disabledMcpServers).not.toContain("vercel (mcpx)");
    // Non-managed names are preserved
    expect(syncedClaude.projects?.["/tmp/old-project"]?.disabledMcpServers).toContain("my-non-managed-entry");
  });

  it("managed index only tracks root enabled entries, not per-project disabled names", () => {
    const env = setupTempEnv("mcpx-sync-claude-managed-index-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers.vercel = { transport: "http", url: "https://mcp.vercel.com", enabled: true };
    config.servers.context7 = { transport: "http", url: "https://context7.com/mcp", enabled: true };
    config.projects = {
      "/tmp/proj": {
        name: "proj",
        path: "/tmp/proj",
        disabledServers: ["context7"]
      }
    };
    saveConfig(config);

    const claudePath = path.join(env.root, ".claude.json");
    fs.writeFileSync(claudePath, JSON.stringify({ mcpServers: {} }, null, 2));

    syncAllClients(config, new SecretsManager());

    const managedIndex = loadManagedIndex(getManagedIndexPath());
    const claudeEntries = Object.keys(managedIndex.managed.claude?.entries ?? {});
    // Index contains both enabled root entries
    expect(claudeEntries).toContain("vercel (mcpx)");
    expect(claudeEntries).toContain("context7 (mcpx)");
    // No project-scoped entries leaked into index
    expect(claudeEntries.every((name) => name.endsWith(" (mcpx)"))).toBe(true);
    expect(claudeEntries.length).toBe(2);
  });

  it("syncs Claude Desktop config successfully", () => {
    const env = setupTempEnv("mcpx-sync-claude-desktop-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: "https://mcp.vercel.com"
    };
    saveConfig(config);

    const claudeDesktopPath = path.join(env.root, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    fs.mkdirSync(path.dirname(claudeDesktopPath), { recursive: true });
    const initialClaudeDesktop = {
      mcpServers: {
        existing_mcp: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@example/existing-mcp"]
        }
      }
    };
    fs.writeFileSync(claudeDesktopPath, JSON.stringify(initialClaudeDesktop, null, 2));

    const summary = syncAllClients(config, new SecretsManager());
    expect(summary.hasErrors).toBe(false);
    expect(summary.results.some((result) => result.clientId === "claude-desktop" && result.status === "SYNCED")).toBe(true);

    const syncedClaudeDesktop = JSON.parse(fs.readFileSync(claudeDesktopPath, "utf8")) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };

    expect(syncedClaudeDesktop.mcpServers["vercel (mcpx)"]?.command).toBeDefined();
    expect(syncedClaudeDesktop.mcpServers["vercel (mcpx)"]?.args).toContain("proxy");
    expect(syncedClaudeDesktop.mcpServers["vercel (mcpx)"]?.args).toContain("vercel");
    expect(syncedClaudeDesktop.mcpServers.existing_mcp).toBeUndefined();
    expect(syncedClaudeDesktop.mcpServers["existing_mcp (mcpx)"]?.command).toBeDefined();
    expect(syncedClaudeDesktop.mcpServers["existing_mcp (mcpx)"]?.args).toContain("proxy");
    expect(syncedClaudeDesktop.mcpServers["existing_mcp (mcpx)"]?.args).toContain("existing_mcp");
    expect(config.servers.existing_mcp).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@example/existing-mcp"],
      env: undefined,
      cwd: undefined,
      enabled: true
    });
  });

  it("syncs Qwen config successfully", () => {
    const env = setupTempEnv("mcpx-sync-qwen-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: "https://mcp.vercel.com"
    };
    saveConfig(config);

    const qwenDir = path.join(env.root, ".qwen");
    fs.mkdirSync(qwenDir, { recursive: true });
    const qwenPath = path.join(qwenDir, "settings.json");
    const initialQwen = {
      mcpServers: {
        existing_qwen_mcp: {
          type: "stdio",
          command: "python",
          args: ["-m", "my_mcp"]
        }
      }
    };
    fs.writeFileSync(qwenPath, JSON.stringify(initialQwen, null, 2));

    const summary = syncAllClients(config, new SecretsManager());
    expect(summary.hasErrors).toBe(false);
    expect(summary.results.some((result) => result.clientId === "qwen" && result.status === "SYNCED")).toBe(true);

    const syncedQwen = JSON.parse(fs.readFileSync(qwenPath, "utf8")) as {
      mcpServers: Record<string, { httpUrl?: string; headers?: Record<string, string> }>;
    };

    expect(syncedQwen.mcpServers["vercel (mcpx)"]?.httpUrl).toContain("127.0.0.1");
    expect(syncedQwen.mcpServers["vercel (mcpx)"]?.headers?.["Authorization"]).toBeDefined();
    expect(syncedQwen.mcpServers["existing_qwen_mcp"]).toBeUndefined();
    expect(syncedQwen.mcpServers["existing_qwen_mcp (mcpx)"]?.httpUrl).toContain("upstream=existing_qwen_mcp");
    expect(config.servers.existing_qwen_mcp).toEqual({
      transport: "stdio",
      command: "python",
      args: ["-m", "my_mcp"],
      env: undefined,
      cwd: undefined,
      enabled: true
    });
  });

  it("imports Codex stdio entries into mcpx, syncs them out, and replaces the source entry", () => {
    const env = setupTempEnv("mcpx-sync-codex-stdio-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    saveConfig(config);

    const codexPath = path.join(env.root, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(codexPath), { recursive: true });
    fs.writeFileSync(codexPath, stringify({
      mcp_servers: {
        stitch: {
          command: "npx",
          args: ["-y", "@openai/stitch-mcp"],
          env: {
            STITCH_API_KEY: "secret"
          }
        }
      }
    } as never));

    const summary = syncAllClients(config, new SecretsManager());

    expect(summary.hasErrors).toBe(false);
    expect(summary.imports.imported).toEqual([
      expect.objectContaining({
        clientId: "codex",
        sourceEntryName: "stitch",
        serverName: "stitch"
      })
    ]);
    expect(config.servers.stitch).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@openai/stitch-mcp"],
      env: {
        STITCH_API_KEY: "secret"
      },
      cwd: undefined,
      enabled: true
    });

    const codexDoc = parse(fs.readFileSync(codexPath, "utf8")) as {
      mcp_servers?: Record<string, { command?: string; url?: string }>;
    };
    expect(codexDoc.mcp_servers?.stitch).toBeUndefined();
    expect(codexDoc.mcp_servers?.["stitch (mcpx)"]?.url).toContain("upstream=stitch");

    const vscodePath = path.join(env.root, "Library", "Application Support", "Code", "User", "mcp.json");
    const vscodeDoc = JSON.parse(fs.readFileSync(vscodePath, "utf8")) as {
      servers: Record<string, { type: string; url?: string }>;
    };
    expect(vscodeDoc.servers["stitch (mcpx)"]?.type).toBe("http");
    expect(vscodeDoc.servers["stitch (mcpx)"]?.url).toContain("upstream=stitch");
  });

  it("imports Codex HTTP entries into mcpx", () => {
    const env = setupTempEnv("mcpx-sync-codex-http-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    saveConfig(config);

    const codexPath = path.join(env.root, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(codexPath), { recursive: true });
    fs.writeFileSync(codexPath, stringify({
      mcp_servers: {
        docs: {
          url: "https://developers.openai.com/mcp",
          http_headers: {
            Authorization: "Bearer abc"
          }
        }
      }
    } as never));

    const summary = syncAllClients(config, new SecretsManager());

    expect(summary.hasErrors).toBe(false);
    expect(config.servers.docs).toEqual({
      transport: "http",
      url: "https://developers.openai.com/mcp",
      headers: {
        Authorization: "Bearer abc"
      },
      enabled: true
    });
    expect(summary.imports.imported).toEqual([
      expect.objectContaining({
        clientId: "codex",
        sourceEntryName: "docs",
        serverName: "docs"
      })
    ]);
  });

  it("imports identical unmanaged entries once and stays idempotent after adoption", () => {
    const env = setupTempEnv("mcpx-sync-import-adopt-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    saveConfig(config);

    const codexPath = path.join(env.root, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(codexPath), { recursive: true });
    fs.writeFileSync(codexPath, stringify({
      mcp_servers: {
        shared: {
          url: "https://example.com/mcp"
        }
      }
    } as never));

    const vscodePath = path.join(env.root, "Library", "Application Support", "Code", "User", "mcp.json");
    fs.mkdirSync(path.dirname(vscodePath), { recursive: true });
    fs.writeFileSync(vscodePath, JSON.stringify({
      servers: {
        shared: {
          type: "http",
          url: "https://example.com/mcp"
        }
      }
    }, null, 2));

    const first = syncAllClients(config, new SecretsManager());
    const second = syncAllClients(config, new SecretsManager());

    expect(first.hasErrors).toBe(false);
    expect(first.imports.imported).toHaveLength(1);
    expect(first.imports.duplicates).toHaveLength(1);
    expect(second.hasErrors).toBe(false);
    expect(second.imports.imported).toHaveLength(0);
    expect(second.imports.duplicates).toHaveLength(0);
    expect(Object.keys(config.servers)).toEqual(["shared"]);

    const codexDoc = parse(fs.readFileSync(codexPath, "utf8")) as {
      mcp_servers?: Record<string, { url?: string }>;
    };
    expect(codexDoc.mcp_servers?.shared).toBeUndefined();
    expect(codexDoc.mcp_servers?.["shared (mcpx)"]?.url).toContain("upstream=shared");

    const vscodeDoc = JSON.parse(fs.readFileSync(vscodePath, "utf8")) as {
      servers: Record<string, { url?: string }>;
    };
    expect(vscodeDoc.servers.shared).toBeUndefined();
    expect(vscodeDoc.servers["shared (mcpx)"]?.url).toContain("upstream=shared");
  });

  it("keeps mcpx as the source of truth when imported entries conflict by name", () => {
    const env = setupTempEnv("mcpx-sync-import-conflict-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers.stitch = {
      transport: "http",
      url: "https://example.com/canonical"
    };
    saveConfig(config);

    const codexPath = path.join(env.root, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(codexPath), { recursive: true });
    fs.writeFileSync(codexPath, stringify({
      mcp_servers: {
        stitch: {
          command: "npx",
          args: ["-y", "@openai/stitch-mcp"]
        }
      }
    } as never));

    const summary = syncAllClients(config, new SecretsManager());

    expect(summary.hasErrors).toBe(true);
    expect(summary.imports.conflicts).toEqual([
      expect.objectContaining({
        clientId: "codex",
        sourceEntryName: "stitch",
        serverName: "stitch"
      })
    ]);
    expect(config.servers.stitch).toEqual({
      transport: "http",
      url: "https://example.com/canonical",
      enabled: true
    });

    const codexDoc = parse(fs.readFileSync(codexPath, "utf8")) as {
      mcp_servers?: Record<string, { command?: string; url?: string }>;
    };
    expect(codexDoc.mcp_servers?.stitch?.command).toBe("npx");
    expect(codexDoc.mcp_servers?.["stitch (mcpx)"]?.url).toContain("upstream=stitch");
  });

  it("never re-imports managed mcpx projections from client configs", () => {
    const env = setupTempEnv("mcpx-sync-import-managed-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    saveConfig(config);

    const codexPath = path.join(env.root, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(codexPath), { recursive: true });
    fs.writeFileSync(codexPath, stringify({
      mcp_servers: {
        "docs (mcpx)": {
          url: "http://127.0.0.1:37373/mcp?upstream=docs"
        }
      }
    } as never));

    const summary = syncAllClients(config, new SecretsManager());

    expect(summary.hasErrors).toBe(false);
    expect(summary.imports.imported).toHaveLength(0);
    expect(summary.imports.duplicates).toHaveLength(0);
    expect(config.servers).toEqual({});
  });

  it("ignores Claude project-scoped entries during reverse import", () => {
    const env = setupTempEnv("mcpx-sync-import-claude-project-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    saveConfig(config);

    const claudePath = path.join(env.root, ".claude.json");
    fs.writeFileSync(claudePath, JSON.stringify({
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
    }, null, 2));

    const summary = syncAllClients(config, new SecretsManager());

    expect(summary.hasErrors).toBe(false);
    expect(summary.imports.imported).toHaveLength(0);
    expect(config.servers).toEqual({});
  });

  it("skips unsupported imported shapes without blocking valid imports", () => {
    const env = setupTempEnv("mcpx-sync-import-skip-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    saveConfig(config);

    const codexPath = path.join(env.root, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(codexPath), { recursive: true });
    fs.writeFileSync(codexPath, stringify({
      mcp_servers: {
        broken: {
          url: "https://example.com/mcp",
          command: "npx"
        }
      }
    } as never));

    const vscodePath = path.join(env.root, "Library", "Application Support", "Code", "User", "mcp.json");
    fs.mkdirSync(path.dirname(vscodePath), { recursive: true });
    fs.writeFileSync(vscodePath, JSON.stringify({
      servers: {
        valid: {
          type: "http",
          url: "https://valid.example.com/mcp"
        }
      }
    }, null, 2));

    const summary = syncAllClients(config, new SecretsManager());

    expect(summary.hasErrors).toBe(false);
    expect(summary.imports.skipped).toEqual([
      expect.objectContaining({
        clientId: "codex",
        sourceEntryName: "broken",
        serverName: "broken"
      })
    ]);
    expect(summary.imports.imported).toEqual([
      expect.objectContaining({
        clientId: "vscode",
        sourceEntryName: "valid",
        serverName: "valid"
      })
    ]);
    expect(config.servers.valid).toEqual({
      transport: "http",
      url: "https://valid.example.com/mcp",
      headers: undefined,
      enabled: true
    });
    expect(config.servers.broken).toBeUndefined();
  });

  it("syncs disabled servers correctly per client convention", () => {
    const env = setupTempEnv("mcpx-sync-disabled-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: "https://mcp.vercel.com",
      enabled: false
    };
    saveConfig(config);

    const summary = syncAllClients(config, new SecretsManager());

    expect(summary.hasErrors).toBe(false);

    // VS Code has no native disabled field — omit the entry entirely
    const vscodePath = path.join(env.root, "Library", "Application Support", "Code", "User", "mcp.json");
    const vscodeDoc = JSON.parse(fs.readFileSync(vscodePath, "utf8")) as {
      servers: Record<string, { disabled?: boolean; type?: string }>;
    };
    expect(vscodeDoc.servers["vercel (mcpx)"]).toBeUndefined();

    // Codex omits disabled entries entirely
    const codexPath = path.join(env.root, ".codex", "config.toml");
    const codexDoc = parse(fs.readFileSync(codexPath, "utf8")) as {
      mcp_servers?: Record<string, { enabled?: boolean; url?: string }>;
    };
    expect(codexDoc.mcp_servers?.["vercel (mcpx)"]).toBeUndefined();
  });

  it("imports disabled unmanaged entries and preserves the disabled state", () => {
    const env = setupTempEnv("mcpx-sync-import-disabled-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    saveConfig(config);

    const vscodePath = path.join(env.root, "Library", "Application Support", "Code", "User", "mcp.json");
    fs.mkdirSync(path.dirname(vscodePath), { recursive: true });
    fs.writeFileSync(vscodePath, JSON.stringify({
      servers: {
        disabled_remote: {
          type: "http",
          url: "https://disabled.example.com/mcp",
          disabled: true
        }
      }
    }, null, 2));

    const summary = syncAllClients(config, new SecretsManager());

    expect(summary.hasErrors).toBe(false);
    expect(summary.imports.imported).toEqual([
      expect.objectContaining({
        clientId: "vscode",
        sourceEntryName: "disabled_remote",
        serverName: "disabled_remote"
      })
    ]);
    expect(config.servers.disabled_remote).toEqual({
      transport: "http",
      url: "https://disabled.example.com/mcp",
      headers: undefined,
      enabled: false
    });

    // VS Code omits disabled entries entirely rather than writing disabled: true
    const syncedVscode = JSON.parse(fs.readFileSync(vscodePath, "utf8")) as {
      servers: Record<string, { disabled?: boolean; url?: string }>;
    };
    expect(syncedVscode.servers["disabled_remote (mcpx)"]).toBeUndefined();
  });

  it("updates managed fingerprints when a server is toggled off and back on", () => {
    const env = setupTempEnv("mcpx-sync-toggle-fingerprint-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: "https://mcp.vercel.com"
    };
    saveConfig(config);

    syncAllClients(config, new SecretsManager());
    const firstFingerprint = loadManagedIndex(getManagedIndexPath()).managed.vscode?.entries["vercel (mcpx)"]?.fingerprint;

    // Disabled → managed entry removed entirely
    config.servers.vercel.enabled = false;
    const disableSummary = syncAllClients(config, new SecretsManager());
    const secondFingerprint = loadManagedIndex(getManagedIndexPath()).managed.vscode?.entries["vercel (mcpx)"]?.fingerprint;

    // Re-enabled → entry recreated with new fingerprint
    config.servers.vercel.enabled = true;
    const summary = syncAllClients(config, new SecretsManager());
    const thirdFingerprint = loadManagedIndex(getManagedIndexPath()).managed.vscode?.entries["vercel (mcpx)"]?.fingerprint;

    expect(firstFingerprint).toBeDefined();
    expect(secondFingerprint).toBeUndefined();
    expect(thirdFingerprint).toBeDefined();
    // Fingerprint may be the same since the underlying spec didn't change
  });

  it("removes disabled servers from Claude mcpServers and keeps disabledMcpServers for UI state", () => {
    const env = setupTempEnv("mcpx-sync-claude-disabled-array-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: "https://mcp.vercel.com",
      enabled: false
    };
    config.servers.context7 = {
      transport: "http",
      url: "https://context7.com/mcp",
      enabled: true
    };
    saveConfig(config);

    const claudePath = path.join(env.root, ".claude.json");
    fs.mkdirSync(path.dirname(claudePath), { recursive: true });
    fs.writeFileSync(claudePath, JSON.stringify({
      disabledMcpServers: ["existing_disabled", "vercel (mcpx)"]
    }, null, 2));

    const summary = syncAllClients(config, new SecretsManager());
    expect(summary.hasErrors).toBe(false);

    const syncedClaude = JSON.parse(fs.readFileSync(claudePath, "utf8")) as {
      mcpServers: Record<string, { type: string; disabled?: boolean }>;
      disabledMcpServers?: string[];
    };

    expect(syncedClaude.mcpServers["vercel (mcpx)"]).toBeUndefined();
    expect(syncedClaude.mcpServers["context7 (mcpx)"]?.type).toBe("http");
    expect(syncedClaude.mcpServers["context7 (mcpx)"]?.disabled).toBeUndefined();

    expect(syncedClaude.disabledMcpServers).not.toContain("vercel (mcpx)");
    expect(syncedClaude.disabledMcpServers).not.toContain("context7 (mcpx)");
    expect(syncedClaude.disabledMcpServers).toContain("existing_disabled");
  });

  it("omits disabled managed servers from Claude Desktop config instead of writing disabled field", () => {
    const env = setupTempEnv("mcpx-sync-claude-desktop-disabled-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: "https://mcp.vercel.com",
      enabled: false
    };
    config.servers.context7 = {
      transport: "http",
      url: "https://context7.com/mcp",
      enabled: true
    };
    saveConfig(config);

    const claudeDesktopPath = path.join(env.root, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    fs.mkdirSync(path.dirname(claudeDesktopPath), { recursive: true });
    fs.writeFileSync(claudeDesktopPath, JSON.stringify({
      mcpServers: {
        existing_unmanaged: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@example/existing"]
        }
      }
    }, null, 2));

    const summary = syncAllClients(config, new SecretsManager());
    expect(summary.hasErrors).toBe(false);

    const synced = JSON.parse(fs.readFileSync(claudeDesktopPath, "utf8")) as {
      mcpServers: Record<string, { command?: string; args?: string[] }>;
    };

    expect(synced.mcpServers["context7 (mcpx)"]?.command).toBeDefined();
    expect(synced.mcpServers["context7 (mcpx)"]?.args).toContain("proxy");
    expect(synced.mcpServers["context7 (mcpx)"]?.args).toContain("context7");
    expect(synced.mcpServers["next-devtools (mcpx)"]).toBeUndefined();

    expect(synced.mcpServers["vercel (mcpx)"]).toBeUndefined();
    expect(synced.mcpServers["existing_unmanaged (mcpx)"]).toBeDefined();
  });

  it("omits disabled managed servers from Cursor config instead of writing disabled field", () => {
    const env = setupTempEnv("mcpx-sync-cursor-disabled-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: "https://mcp.vercel.com",
      enabled: false
    };
    config.servers.context7 = {
      transport: "http",
      url: "https://context7.com/mcp",
      enabled: true
    };
    saveConfig(config);

    const cursorPath = path.join(env.root, ".cursor", "mcp.json");
    fs.mkdirSync(path.dirname(cursorPath), { recursive: true });
    fs.writeFileSync(cursorPath, JSON.stringify({
      mcpServers: {
        existingServer: { url: "https://example.com/mcp" }
      }
    }, null, 2));

    const summary = syncAllClients(config, new SecretsManager());
    expect(summary.hasErrors).toBe(false);

    const synced = JSON.parse(fs.readFileSync(cursorPath, "utf8")) as {
      mcpServers: Record<string, { type?: string; url?: string; disabled?: boolean }>;
    };

    expect(synced.mcpServers["context7 (mcpx)"]?.type).toBe("http");
    expect(synced.mcpServers["context7 (mcpx)"]?.disabled).toBeUndefined();
    expect(synced.mcpServers["vercel (mcpx)"]).toBeUndefined();
    expect(synced.mcpServers["existingServer"]).toBeUndefined();
    expect(synced.mcpServers["existingServer (mcpx)"]).toBeDefined();
  });

  it("omits disabled managed servers from VS Code config instead of writing disabled field", () => {
    const env = setupTempEnv("mcpx-sync-vscode-disabled-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: "https://mcp.vercel.com",
      enabled: false
    };
    config.servers.context7 = {
      transport: "http",
      url: "https://context7.com/mcp",
      enabled: true
    };
    saveConfig(config);

    const vscodePath = path.join(env.root, "Library", "Application Support", "Code", "User", "mcp.json");
    fs.mkdirSync(path.dirname(vscodePath), { recursive: true });
    fs.writeFileSync(vscodePath, JSON.stringify({
      servers: {
        existingServer: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@example/existing"]
        }
      }
    }, null, 2));

    const summary = syncAllClients(config, new SecretsManager());
    expect(summary.hasErrors).toBe(false);

    const synced = JSON.parse(fs.readFileSync(vscodePath, "utf8")) as {
      servers: Record<string, { type?: string; url?: string; disabled?: boolean }>;
    };

    expect(synced.servers["context7 (mcpx)"]?.type).toBe("http");
    expect(synced.servers["context7 (mcpx)"]?.disabled).toBeUndefined();
    expect(synced.servers["vercel (mcpx)"]).toBeUndefined();
    expect(synced.servers["existingServer"]).toBeUndefined();
    expect(synced.servers["existingServer (mcpx)"]).toBeDefined();
  });

  it("syncs Qwen disabled servers to mcp.excluded array instead of disabled property", () => {
    const env = setupTempEnv("mcpx-sync-qwen-disabled-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: "https://mcp.vercel.com",
      enabled: false
    };
    config.servers.context7 = {
      transport: "http",
      url: "https://context7.com/mcp",
      enabled: true
    };
    saveConfig(config);

    const qwenDir = path.join(env.root, ".qwen");
    fs.mkdirSync(qwenDir, { recursive: true });
    const qwenPath = path.join(qwenDir, "settings.json");
    fs.writeFileSync(qwenPath, JSON.stringify({
      mcp: { excluded: ["existing_disabled"] }
    }, null, 2));

    const summary = syncAllClients(config, new SecretsManager());
    expect(summary.hasErrors).toBe(false);

    const synced = JSON.parse(fs.readFileSync(qwenPath, "utf8")) as {
      mcpServers: Record<string, { httpUrl?: string; disabled?: boolean }>;
      mcp?: { excluded?: string[] };
    };

    expect(synced.mcpServers["vercel (mcpx)"]?.httpUrl).toBeDefined();
    expect(synced.mcpServers["vercel (mcpx)"]?.disabled).toBeUndefined();
    expect(synced.mcpServers["context7 (mcpx)"]?.httpUrl).toBeDefined();
    expect(synced.mcpServers["context7 (mcpx)"]?.disabled).toBeUndefined();

    expect(synced.mcp?.excluded).not.toContain("vercel (mcpx)");
    expect(synced.mcp?.excluded).not.toContain("context7 (mcpx)");
    expect(synced.mcp?.excluded).toContain("existing_disabled");
  });

  it("syncs Cursor config to ~/.cursor/mcp.json with mcpServers key", () => {
    const env = setupTempEnv("mcpx-sync-cursor-path-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: "https://mcp.vercel.com"
    };
    saveConfig(config);

    const summary = syncAllClients(config, new SecretsManager());
    expect(summary.hasErrors).toBe(false);
    expect(summary.results.some((result) => result.clientId === "cursor" && result.status === "SYNCED")).toBe(true);

    // Cursor moved global MCP config to ~/.cursor/mcp.json and uses the mcpServers key.
    const cursorPath = path.join(env.root, ".cursor", "mcp.json");
    const synced = JSON.parse(fs.readFileSync(cursorPath, "utf8")) as {
      mcpServers: Record<string, { type?: string; url?: string; headers?: Record<string, string> }>;
    };

    expect(synced.mcpServers["vercel (mcpx)"]?.type).toBe("http");
    expect(synced.mcpServers["vercel (mcpx)"]?.url).toContain("127.0.0.1");
    expect(synced.mcpServers["vercel (mcpx)"]?.url).toContain("upstream=vercel");
    expect(typeof synced.mcpServers["vercel (mcpx)"]?.headers?.["Authorization"]).toBe("string");

    // The legacy VS Code-style Application Support path must no longer be used.
    const legacyPath = path.join(env.root, "Library", "Application Support", "Cursor", "User", "mcp.json");
    expect(fs.existsSync(legacyPath)).toBe(false);
  });

  it("imports Claude Code streamable-http entries as HTTP servers", () => {
    const env = setupTempEnv("mcpx-sync-claude-streamable-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    saveConfig(config);

    const claudePath = path.join(env.root, ".claude.json");
    fs.writeFileSync(claudePath, JSON.stringify({
      mcpServers: {
        streamable_server: {
          type: "streamable-http",
          url: "https://streamable.example.com/mcp"
        }
      }
    }, null, 2));

    const summary = syncAllClients(config, new SecretsManager());

    expect(summary.hasErrors).toBe(false);
    expect(summary.imports.imported).toEqual([
      expect.objectContaining({
        clientId: "claude",
        sourceEntryName: "streamable_server",
        serverName: "streamable_server"
      })
    ]);
    expect(config.servers.streamable_server).toEqual({
      transport: "http",
      url: "https://streamable.example.com/mcp",
      headers: undefined,
      enabled: true
    });
  });

  it("imports OpenCode local servers with array command and environment key", () => {
    const env = setupTempEnv("mcpx-sync-opencode-local-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    saveConfig(config);

    const opencodePath = path.join(env.root, ".config", "opencode", "opencode.json");
    fs.mkdirSync(path.dirname(opencodePath), { recursive: true });
    fs.writeFileSync(opencodePath, JSON.stringify({
      mcp: {
        local_server: {
          type: "local",
          command: ["npx", "-y", "@example/local-server"],
          environment: {
            API_KEY: "secret"
          }
        }
      }
    }, null, 2));

    const summary = syncAllClients(config, new SecretsManager());

    expect(summary.hasErrors).toBe(false);
    expect(summary.imports.imported).toEqual([
      expect.objectContaining({
        clientId: "opencode",
        sourceEntryName: "local_server",
        serverName: "local_server"
      })
    ]);
    expect(config.servers.local_server).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@example/local-server"],
      env: {
        API_KEY: "secret"
      },
      cwd: undefined,
      enabled: true
    });
  });

  it("syncs Cline CLI config at ~/.cline/settings/cline_mcp_settings.json when no IDE extension config exists", () => {
    const env = setupTempEnv("mcpx-sync-cline-cli-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: "https://mcp.vercel.com"
    };
    saveConfig(config);

    const clineCliPath = path.join(env.root, ".cline", "settings", "cline_mcp_settings.json");
    fs.mkdirSync(path.dirname(clineCliPath), { recursive: true });
    fs.writeFileSync(clineCliPath, JSON.stringify({
      mcpServers: {
        existing_cli: {
          command: "npx",
          args: ["-y", "@example/cli-server"]
        }
      }
    }, null, 2));

    const summary = syncAllClients(config, new SecretsManager());
    expect(summary.hasErrors).toBe(false);
    expect(summary.results.some((result) => result.clientId === "cline" && result.status === "SYNCED")).toBe(true);

    const synced = JSON.parse(fs.readFileSync(clineCliPath, "utf8")) as {
      mcpServers: Record<string, { type?: string; url?: string }>;
    };

    expect(synced.mcpServers["vercel (mcpx)"]?.type).toBe("streamableHttp");
    expect(synced.mcpServers["vercel (mcpx)"]?.url).toContain("upstream=vercel");
    expect(synced.mcpServers["existing_cli"]).toBeUndefined();
    expect(synced.mcpServers["existing_cli (mcpx)"]).toBeDefined();
  });

  it("imports Cline stdio entries into mcpx and replaces the source entry", () => {
    const env = setupTempEnv("mcpx-sync-cline-import-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    saveConfig(config);

    const clinePath = path.join(
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
    fs.mkdirSync(path.dirname(clinePath), { recursive: true });
    fs.writeFileSync(clinePath, JSON.stringify({
      mcpServers: {
        some_tool: {
          transportType: "stdio",
          command: "npx",
          args: ["-y", "@example/some-tool"]
        }
      }
    }, null, 2));

    const summary = syncAllClients(config, new SecretsManager());

    expect(summary.hasErrors).toBe(false);
    expect(summary.imports.imported).toEqual([
      expect.objectContaining({
        clientId: "cline",
        sourceEntryName: "some_tool",
        serverName: "some_tool"
      })
    ]);
    expect(config.servers.some_tool).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@example/some-tool"],
      env: undefined,
      cwd: undefined,
      enabled: true
    });

    const synced = JSON.parse(fs.readFileSync(clinePath, "utf8")) as {
      mcpServers: Record<string, { type?: string; url?: string }>;
    };
    expect(synced.mcpServers.some_tool).toBeUndefined();
    expect(synced.mcpServers["some_tool (mcpx)"]?.type).toBe("streamableHttp");
  });

  it("imports Cline HTTP entries declared with type: streamableHttp (new format)", () => {
    const env = setupTempEnv("mcpx-sync-cline-import-type-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    saveConfig(config);

    const clinePath = path.join(
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
    fs.mkdirSync(path.dirname(clinePath), { recursive: true });
    fs.writeFileSync(clinePath, JSON.stringify({
      mcpServers: {
        remote_api: {
          type: "streamableHttp",
          url: "https://api.example.com/mcp",
          headers: { Authorization: "Bearer token123" }
        }
      }
    }, null, 2));

    const summary = syncAllClients(config, new SecretsManager());

    expect(summary.hasErrors).toBe(false);
    expect(summary.imports.imported).toEqual([
      expect.objectContaining({
        clientId: "cline",
        sourceEntryName: "remote_api",
        serverName: "remote_api"
      })
    ]);
    expect(config.servers.remote_api).toEqual({
      transport: "http",
      url: "https://api.example.com/mcp",
      headers: { Authorization: "Bearer token123" },
      enabled: true
    });

    const synced = JSON.parse(fs.readFileSync(clinePath, "utf8")) as {
      mcpServers: Record<string, { type?: string; url?: string }>;
    };
    expect(synced.mcpServers.remote_api).toBeUndefined();
    expect(synced.mcpServers["remote_api (mcpx)"]?.type).toBe("streamableHttp");
  });

  it("imports Cline HTTP entries with legacy transportType: http", () => {
    const env = setupTempEnv("mcpx-sync-cline-import-legacy-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    saveConfig(config);

    const clinePath = path.join(
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
    fs.mkdirSync(path.dirname(clinePath), { recursive: true });
    fs.writeFileSync(clinePath, JSON.stringify({
      mcpServers: {
        legacy_http: {
          transportType: "http",
          url: "https://legacy.example.com/mcp"
        }
      }
    }, null, 2));

    const summary = syncAllClients(config, new SecretsManager());

    expect(summary.hasErrors).toBe(false);
    expect(summary.imports.imported).toEqual([
      expect.objectContaining({
        clientId: "cline",
        sourceEntryName: "legacy_http",
        serverName: "legacy_http"
      })
    ]);
    expect(config.servers.legacy_http).toEqual({
      transport: "http",
      url: "https://legacy.example.com/mcp",
      enabled: true
    });
  });

  it("prunes removed Cline managed entries from the VS Code extension config", () => {
    const env = setupTempEnv("mcpx-sync-cline-prune-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: "https://mcp.vercel.com"
    };
    config.servers.context7 = {
      transport: "http",
      url: "https://context7.com/mcp"
    };
    saveConfig(config);

    const clinePath = path.join(
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
    // Cline's adapter skips sync when the config file doesn't exist (it won't
    // create a config for an uninstalled IDE), so pre-create it like every
    // other Cline test.
    fs.mkdirSync(path.dirname(clinePath), { recursive: true });
    fs.writeFileSync(clinePath, JSON.stringify({ mcpServers: {} }, null, 2));

    const first = syncAllClients(config, new SecretsManager());
    expect(first.hasErrors).toBe(false);

    const firstDoc = JSON.parse(fs.readFileSync(clinePath, "utf8")) as {
      mcpServers: Record<string, { type?: string }>;
    };
    expect(firstDoc.mcpServers["vercel (mcpx)"]?.type).toBe("streamableHttp");
    expect(firstDoc.mcpServers["context7 (mcpx)"]?.type).toBe("streamableHttp");

    delete config.servers.context7;
    saveConfig(config);

    const second = syncAllClients(config, new SecretsManager());
    expect(second.hasErrors).toBe(false);

    const secondDoc = JSON.parse(fs.readFileSync(clinePath, "utf8")) as {
      mcpServers: Record<string, { type?: string }>;
    };
    expect(secondDoc.mcpServers["vercel (mcpx)"]?.type).toBe("streamableHttp");
    expect(secondDoc.mcpServers["context7 (mcpx)"]).toBeUndefined();

    const managed = loadManagedIndex(getManagedIndexPath());
    expect(Object.keys(managed.managed.cline?.entries ?? {})).toEqual(["vercel (mcpx)"]);
  });

  it("syncs Kiro config successfully", () => {
    const env = setupTempEnv("mcpx-sync-kiro-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: "https://mcp.vercel.com"
    };
    saveConfig(config);

    const kiroDir = path.join(env.root, ".kiro", "settings");
    fs.mkdirSync(kiroDir, { recursive: true });
    const kiroPath = path.join(kiroDir, "mcp.json");
    const initialKiro = {
      mcpServers: {
        existing_kiro: {
          command: "npx",
          args: ["-y", "@example/kiro-server"]
        }
      }
    };
    fs.writeFileSync(kiroPath, JSON.stringify(initialKiro, null, 2));

    const summary = syncAllClients(config, new SecretsManager());
    expect(summary.hasErrors).toBe(false);
    expect(summary.results.some((result) => result.clientId === "kiro" && result.status === "SYNCED")).toBe(true);

    const synced = JSON.parse(fs.readFileSync(kiroPath, "utf8")) as {
      mcpServers: Record<string, { url?: string; headers?: Record<string, string>; disabled?: boolean }>;
    };

    expect(synced.mcpServers["vercel (mcpx)"]?.url).toContain("127.0.0.1");
    expect(synced.mcpServers["vercel (mcpx)"]?.url).toContain("upstream=vercel");
    expect(typeof synced.mcpServers["vercel (mcpx)"]?.headers?.["Authorization"]).toBe("string");
    expect(synced.mcpServers["existing_kiro"]).toBeUndefined();
    expect(synced.mcpServers["existing_kiro (mcpx)"]?.url).toContain("upstream=existing_kiro");
    expect(config.servers.existing_kiro).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@example/kiro-server"],
      env: undefined,
      cwd: undefined,
      enabled: true
    });
  });

  it("syncs OpenCode gateway config successfully", () => {
    const env = setupTempEnv("mcpx-sync-opencode-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: "https://mcp.vercel.com"
    };
    saveConfig(config);

    const opencodeDir = path.join(env.root, ".config", "opencode");
    fs.mkdirSync(opencodeDir, { recursive: true });
    const opencodePath = path.join(opencodeDir, "opencode.json");

    const summary = syncAllClients(config, new SecretsManager());
    expect(summary.hasErrors).toBe(false);
    expect(summary.results.some((result) => result.clientId === "opencode" && result.status === "SYNCED")).toBe(true);

    const synced = JSON.parse(fs.readFileSync(opencodePath, "utf8")) as {
      mcp: Record<string, { type?: string; url?: string; headers?: Record<string, string>; enabled?: boolean }>;
    };

    expect(synced.mcp["vercel (mcpx)"]?.type).toBe("remote");
    expect(synced.mcp["vercel (mcpx)"]?.url).toContain("127.0.0.1");
    expect(synced.mcp["vercel (mcpx)"]?.url).toContain("upstream=vercel");
    expect(typeof synced.mcp["vercel (mcpx)"]?.headers?.["Authorization"]).toBe("string");
  });

  it("writes disabled managed servers with disabled/disabled field in Cline, OpenCode, and Kiro", () => {
    const env = setupTempEnv("mcpx-sync-disabled-others-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: "https://mcp.vercel.com",
      enabled: false
    };
    config.servers.context7 = {
      transport: "http",
      url: "https://context7.com/mcp",
      enabled: true
    };
    saveConfig(config);

    // Pre-create ~/.cline/settings/cline_mcp_settings.json so detectConfigPath
    // picks the Cline CLI path (not the VSCode extension path).
    const clinePrePath = path.join(env.root, ".cline", "settings", "cline_mcp_settings.json");
    fs.mkdirSync(path.dirname(clinePrePath), { recursive: true });
    fs.writeFileSync(clinePrePath, JSON.stringify({ mcpServers: {} }, null, 2));

    const summary = syncAllClients(config, new SecretsManager());
    expect(summary.hasErrors).toBe(false);

    // Cline: disabled entries omitted entirely
    const clineDoc = JSON.parse(fs.readFileSync(clinePrePath, "utf8")) as {
      mcpServers: Record<string, { type?: string; disabled?: boolean }>;
    };
    expect(clineDoc.mcpServers["vercel (mcpx)"]).toBeUndefined();
    expect(clineDoc.mcpServers["context7 (mcpx)"]?.disabled).toBeUndefined();

    // OpenCode: disabled entries omitted entirely
    const opencodePath = path.join(env.root, ".config", "opencode", "opencode.json");
    const opencodeDoc = JSON.parse(fs.readFileSync(opencodePath, "utf8")) as {
      mcp: Record<string, { type?: string; enabled?: boolean }>;
    };
    expect(opencodeDoc.mcp["vercel (mcpx)"]).toBeUndefined();
    expect(opencodeDoc.mcp["context7 (mcpx)"]?.enabled).toBeUndefined();

    // Kiro: disabled entries omitted entirely
    const kiroPath = path.join(env.root, ".kiro", "settings", "mcp.json");
    const kiroDoc = JSON.parse(fs.readFileSync(kiroPath, "utf8")) as {
      mcpServers: Record<string, { url?: string; disabled?: boolean }>;
    };
    expect(kiroDoc.mcpServers["vercel (mcpx)"]).toBeUndefined();
    expect(kiroDoc.mcpServers["context7 (mcpx)"]?.disabled).toBeUndefined();
  });

  it("imports Kiro HTTP entries into mcpx", () => {
    const env = setupTempEnv("mcpx-sync-kiro-import-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    saveConfig(config);

    const kiroDir = path.join(env.root, ".kiro", "settings");
    fs.mkdirSync(kiroDir, { recursive: true });
    const kiroPath = path.join(kiroDir, "mcp.json");
    fs.writeFileSync(kiroPath, JSON.stringify({
      mcpServers: {
        kiro_remote: {
          url: "https://kiro.example.com/mcp",
          headers: {
            Authorization: "Bearer secret"
          }
        }
      }
    }, null, 2));

    const summary = syncAllClients(config, new SecretsManager());

    expect(summary.hasErrors).toBe(false);
    expect(summary.imports.imported).toEqual([
      expect.objectContaining({
        clientId: "kiro",
        sourceEntryName: "kiro_remote",
        serverName: "kiro_remote"
      })
    ]);
    expect(config.servers.kiro_remote).toEqual({
      transport: "http",
      url: "https://kiro.example.com/mcp",
      headers: {
        Authorization: "Bearer secret"
      },
      enabled: true
    });
  });

  it("imports Qwen SSE (url) entries into mcpx", () => {
    const env = setupTempEnv("mcpx-sync-qwen-import-");
    cleanups.push(env.restore);

    const config = defaultConfig();
    saveConfig(config);

    const qwenDir = path.join(env.root, ".qwen");
    fs.mkdirSync(qwenDir, { recursive: true });
    const qwenPath = path.join(qwenDir, "settings.json");
    fs.writeFileSync(qwenPath, JSON.stringify({
      mcpServers: {
        qwen_sse: {
          url: "https://events.example.com/mcp",
          headers: {
            Authorization: "Bearer secret"
          }
        }
      }
    }, null, 2));

    const summary = syncAllClients(config, new SecretsManager());

    expect(summary.hasErrors).toBe(false);
    expect(summary.imports.imported).toEqual([
      expect.objectContaining({
        clientId: "qwen",
        sourceEntryName: "qwen_sse",
        serverName: "qwen_sse"
      })
    ]);
    expect(config.servers.qwen_sse).toEqual({
      transport: "http",
      url: "https://events.example.com/mcp",
      headers: {
        Authorization: "Bearer secret"
      },
      enabled: true
    });
  });
});
