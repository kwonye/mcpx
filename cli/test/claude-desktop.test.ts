import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { ClaudeDesktopAdapter } from "../src/adapters/claude-desktop.js";
import { defaultManagedIndex } from "../src/core/managed-index.js";
import { localCliCommand } from "../src/core/runtime-entry.js";
import { getManagedIndexPath } from "../src/core/paths.js";
import { defaultConfig } from "../src/core/config.js";
import { setupTempEnv } from "./helpers.js";

describe("Claude Desktop managed gateway entries", () => {
  it("uses the installed CLI entry and passes its consumer token to the proxy", () => {
    const temp = setupTempEnv("claude-desktop-proxy-");
    const originalCliEntry = process.env.MCPX_CLI_ENTRY;
    const cliEntry = path.join(temp.root, "installed-mcpx.js");
    fs.writeFileSync(cliEntry, "");
    process.env.MCPX_CLI_ENTRY = cliEntry;

    try {
      const adapter = new ClaudeDesktopAdapter();
      const result = adapter.syncGateway(defaultConfig(), {
        managedEntries: [{
          name: "upstream (mcpx)",
          url: "http://127.0.0.1:37373/mcp?upstream=upstream",
          headers: { Authorization: "Bearer consumer-test-token" },
          enabled: true
        }],
        managedIndex: defaultManagedIndex(),
        managedIndexPath: getManagedIndexPath()
      });

      expect(result.status).toBe("SYNCED");
      const configPath = adapter.detectConfigPath();
      expect(configPath).not.toBeNull();
      const servers = JSON.parse(fs.readFileSync(configPath!, "utf8")).mcpServers;
      const proxy = servers["upstream (mcpx)"];
      const expected = localCliCommand(["proxy", "upstream"]);

      expect(proxy.command).toBe(expected.command);
      expect(proxy.args).toEqual(expected.args);
      expect(proxy.env).toMatchObject({
        MCPX_CLI_ENTRY: cliEntry,
        MCPX_PROXY_TOKEN: "consumer-test-token"
      });
      expect(proxy.command).not.toBe("npx");
    } finally {
      if (originalCliEntry === undefined) delete process.env.MCPX_CLI_ENTRY;
      else process.env.MCPX_CLI_ENTRY = originalCliEntry;
      temp.restore();
    }
  });
});
