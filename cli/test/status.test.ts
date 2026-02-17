import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/core/config.js";
import { buildStatusReport } from "../src/core/status.js";
import type { DaemonStatus } from "../src/core/daemon.js";
import type { ManagedIndex } from "../src/types.js";

function mockDaemonStatus(): DaemonStatus {
  return {
    running: false,
    pidFile: "/tmp/mcpx.pid",
    logFile: "/tmp/mcpx.log",
    port: 37373
  };
}

describe("status report", () => {
  it("maps per-server synced client configs from managed index", () => {
    const config = defaultConfig();
    config.servers.vercel = {
      transport: "http",
      url: "https://mcp.vercel.com",
      headers: {
        Authorization: "secret://vercel_auth"
      }
    };
    config.servers["next-devtools"] = {
      transport: "stdio",
      command: "npx",
      args: ["next-devtools-mcp@latest"]
    };
    config.clients.claude = {
      status: "SYNCED",
      configPath: "/Users/test/.claude.json"
    };
    config.clients.codex = {
      status: "ERROR",
      configPath: "/Users/test/.codex/config.toml",
      message: "Cannot sync managed entry."
    };

    const managedIndex: ManagedIndex = {
      schemaVersion: 1,
      managed: {
        claude: {
          configPath: "/Users/test/.claude.json",
          entries: {
            vercel: {
              fingerprint: "sha",
              lastSyncedAt: "2026-02-15T00:00:00.000Z"
            }
          }
        },
        codex: {
          configPath: "/Users/test/.codex/config.toml",
          entries: {
            vercel: {
              fingerprint: "sha2",
              lastSyncedAt: "2026-02-15T00:00:01.000Z"
            }
          }
        }
      }
    };

    const report = buildStatusReport(config, managedIndex, mockDaemonStatus());
    const vercel = report.servers.find((server) => server.name === "vercel");

    expect(vercel).toBeDefined();
    expect(vercel?.authBindings).toEqual([{
      kind: "header",
      key: "Authorization",
      value: "secret://vercel_auth",
      secretName: "vercel_auth"
    }]);
    expect(vercel?.clients.filter((client) => client.managed).map((client) => client.clientId).sort()).toEqual([
      "claude",
      "codex"
    ]);
    expect(vercel?.clients.find((client) => client.clientId === "codex")).toMatchObject({
      managed: true,
      status: "ERROR",
      configPath: "/Users/test/.codex/config.toml",
      message: "Cannot sync managed entry."
    });
  });

  it("marks managed entries as synced even when client state was never recorded", () => {
    const config = defaultConfig();
    config.servers.circleback = {
      transport: "http",
      url: "https://app.circleback.ai/api/mcp"
    };

    const managedIndex: ManagedIndex = {
      schemaVersion: 1,
      managed: {
        kiro: {
          configPath: "/Users/test/.kiro/mcp.json",
          entries: {
            circleback: {
              fingerprint: "sha",
              lastSyncedAt: "2026-02-15T00:00:00.000Z"
            }
          }
        }
      }
    };

    const report = buildStatusReport(config, managedIndex, mockDaemonStatus());
    const circleback = report.servers.find((server) => server.name === "circleback");
    const kiro = circleback?.clients.find((client) => client.clientId === "kiro");

    expect(kiro).toMatchObject({
      managed: true,
      status: "SYNCED",
      configPath: "/Users/test/.kiro/mcp.json",
      lastSyncAt: "2026-02-15T00:00:00.000Z"
    });
  });
});
