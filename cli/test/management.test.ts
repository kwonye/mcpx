import { afterEach, beforeEach, expect, it } from "bun:test";
import { defaultConfig, loadConfig, saveConfig } from "../src/core/config.js";
import { managementCommand } from "../src/core/management.js";
import { setupTempEnv } from "./helpers.js";

let restore: (() => void) | undefined;

beforeEach(() => {
  restore = setupTempEnv("mcpx-management-").restore;
});

afterEach(() => {
  restore?.();
  restore = undefined;
});

it("retains an explicitly provided scope through management server updates", async () => {
  const config = defaultConfig();
  config.servers.github = { transport: "stdio", command: "old-command", scope: "/old/project" };
  saveConfig(config);

  await managementCommand("server.update", ["github", { transport: "stdio", command: "new-command", scope: "/new/project" }]);

  expect(loadConfig().servers.github).toMatchObject({ command: "new-command", scope: "/new/project" });
});

it("rejects a non-string management server scope", async () => {
  await expect(managementCommand("server.update", ["github", { transport: "stdio", command: "node", scope: 42 }])).rejects.toThrow();
});
