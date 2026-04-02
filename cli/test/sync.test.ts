import fs from "node:fs";
import path from "node:path";
import { parse, stringify } from "@iarna/toml";
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
      cwd: undefined
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

    expect(syncedClaude.mcpServers["vercel (mcpx)"]?.type).toBe("http");
    expect(syncedClaude.mcpServers["vercel (mcpx)"]?.url).toContain("127.0.0.1");

    const projectServers = syncedClaude.projects?.["/tmp/project-a"]?.mcpServers ?? {};
    expect(projectServers.project_only?.type).toBe("stdio");
    expect(projectServers["vercel (mcpx)"]).toBeUndefined();
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
      mcpServers: Record<string, { type: string; url?: string; headers?: Record<string, string> }>;
    };

    expect(syncedClaudeDesktop.mcpServers["vercel (mcpx)"]?.type).toBe("http");
    expect(syncedClaudeDesktop.mcpServers["vercel (mcpx)"]?.url).toContain("127.0.0.1");
    expect(syncedClaudeDesktop.mcpServers["vercel (mcpx)"]?.url).toContain("upstream=vercel");
    expect(typeof syncedClaudeDesktop.mcpServers["vercel (mcpx)"].headers?.["Authorization"]).toBe("string");
    expect(syncedClaudeDesktop.mcpServers.existing_mcp).toBeUndefined();
    expect(syncedClaudeDesktop.mcpServers["existing_mcp (mcpx)"]?.type).toBe("http");
    expect(config.servers.existing_mcp).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@example/existing-mcp"],
      env: undefined,
      cwd: undefined
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
      cwd: undefined
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
      cwd: undefined
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
      }
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
      url: "https://example.com/canonical"
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
      headers: undefined
    });
    expect(config.servers.broken).toBeUndefined();
  });
});
