import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, defaultConfig, saveConfig } from "../src/core/config.js";
import { runCli } from "../src/cli.js";
import { setupTempEnv } from "./helpers.js";

describe("cli enable/disable commands", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it("disables and re-enables servers while syncing the managed client entries", async () => {
    const env = setupTempEnv("mcpx-cli-toggle-");
    cleanups.push(env.restore);

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
