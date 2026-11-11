import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "bun:test";
import { defaultConfig, loadConfig, saveConfig } from "../src/core/config.js";
import { mutateConfig } from "../src/core/config-store.js";
import { synchronizeClients } from "../src/core/sync.js";
import { managementCommand } from "../src/core/management.js";
import { SecretsManager } from "../src/core/secrets.js";
import { resolveConsumer } from "../src/core/consumers.js";
import { planSynchronization } from "../src/core/sync-plan.js";
import { setupTempEnv } from "./helpers.js";

let env: ReturnType<typeof setupTempEnv>;
beforeEach(() => { env = setupTempEnv("mcpx-sync-service-"); });
afterEach(() => { env.restore(); });
const piPath = () => path.join(env.root, ".pi/agent/mcp.json");

it("does not create harness installations unless detected or explicitly selected", async () => {
  saveConfig(defaultConfig());
  expect(planSynchronization().harnesses).toEqual([]);
  expect(planSynchronization([]).harnesses).toEqual([]);
  expect(planSynchronization(["pi"]).harnesses.map(h => h.id)).toEqual(["pi"]);
  expect((await synchronizeClients()).results).toEqual([]);
  expect(fs.existsSync(path.join(env.root, ".pi"))).toBe(false);
  expect((await synchronizeClients({ targetClients: ["pi"] })).results[0].clientId).toBe("pi");
  expect(fs.existsSync(piPath())).toBe(true);
  await expect(synchronizeClients({ targetClients: ["unknown"] })).rejects.toThrow("Unknown harness");
});

it("shares upstream credentials while keeping stable, distinct harness credentials", async () => {
  const config = defaultConfig();
  config.servers.shared = { transport: "stdio", command: "node", env: { API_KEY: "secret://shared-key" } };
  config.harnesses = { pi: { mode: "selected" }, cursor: { mode: "selected" } };
  saveConfig(config);
  const secrets = new SecretsManager();
  secrets.setSecret("shared-key", "upstream-private-value");
  await synchronizeClients();
  const first = fs.readFileSync(piPath(), "utf8");
  const cursor = fs.readFileSync(path.join(env.root, ".cursor/mcp.json"), "utf8");
  expect(first).not.toContain("upstream-private-value");
  expect(cursor).not.toContain("upstream-private-value");
  const token = JSON.parse(first).mcpServers.shared__mcpx.headers.Authorization.slice(7);
  const cursorToken = JSON.parse(cursor).mcpServers["shared (mcpx)"].headers.Authorization.slice(7);
  expect(token).not.toBe(cursorToken);
  expect(resolveConsumer(loadConfig(), token)).toEqual({ id: "pi", projectPath: undefined });
  await synchronizeClients();
  expect(fs.readFileSync(piPath(), "utf8")).toBe(first);
  expect(secrets.getSecret("shared-key")).toBe("upstream-private-value");
});

it("reloads after queued mutations and persists projections and status in one transaction", async () => {
  const config = defaultConfig();
  config.harnesses = { pi: { mode: "selected" } };
  saveConfig(config);
  await Promise.all([
    mutateConfig(async fresh => {
      await new Promise(resolve => setTimeout(resolve, 20));
      fresh.servers.added = { transport: "stdio", command: "node" };
    }),
    synchronizeClients(),
    mutateConfig(fresh => { fresh.gateway.autoStart = false; }),
  ]);
  const fresh = loadConfig();
  expect(fresh.servers.added).toBeDefined();
  expect(fresh.gateway.autoStart).toBe(false);
  expect(fresh.clients.pi?.status).toBe("SYNCED");
  expect(JSON.parse(fs.readFileSync(piPath(), "utf8")).mcpServers.added__mcpx).toBeDefined();
  expect(fresh.revision).toBe(3);
});

it("respects observe mode even for explicitly requested targets", async () => {
  const config = defaultConfig();
  config.harnesses = { pi: { mode: "observe" } };
  saveConfig(config);
  expect((await synchronizeClients({ targetClients: ["pi"] })).results).toEqual([]);
  expect(fs.existsSync(piPath())).toBe(false);
});

it("keeps custom config transactions out of the default catalog and uses the supplied vault", async () => {
  const original = defaultConfig();
  original.servers.original = { transport: "stdio", command: "original" };
  saveConfig(original);
  const customPath = path.join(env.root, "separate/config.json");
  const custom = defaultConfig();
  custom.servers.custom = { transport: "stdio", command: "custom" };
  saveConfig(custom, customPath);
  const secrets = new SecretsManager(path.join(env.root, "separate/vault.json"), path.join(env.root, "separate/key"));
  fs.mkdirSync(path.dirname(piPath()), { recursive: true });
  fs.writeFileSync(piPath(), JSON.stringify({ mcpServers: { imported: { command: "node", env: { API_KEY: "imported-private-value" } } } }));
  await synchronizeClients({ configPath: customPath, targetClients: ["pi"], importScan: true }, secrets);
  expect(loadConfig().servers.original).toBeDefined();
  expect(loadConfig().servers.custom).toBeUndefined();
  const header = JSON.parse(fs.readFileSync(piPath(), "utf8")).mcpServers.custom__mcpx.headers.Authorization;
  expect(resolveConsumer(loadConfig(customPath), header.slice(7), secrets)?.id).toBe("pi");
  const imported = loadConfig(customPath).servers.imported;
  expect(imported.transport).toBe("stdio");
  if (imported.transport === "stdio") expect(secrets.resolveMaybeSecret(imported.env!.API_KEY)).toBe("imported-private-value");
  expect(new SecretsManager().listSecretNames()).toEqual([]);
});

it("configures stdio credentials through the same management API used by desktop", async () => {
  const config = defaultConfig();
  config.servers.github = { transport: "stdio", command: "node" };
  saveConfig(config);
  await managementCommand("auth.configure", [{ serverName: "github", envName: "GITHUB_TOKEN", authValue: "private-token" }]);
  expect(loadConfig().servers.github).toMatchObject({ env: { GITHUB_TOKEN: "secret://auth_github_env_github_token" } });
  expect(new SecretsManager().getSecret("auth_github_env_github_token")).toBe("private-token");
  await expect(managementCommand("auth.configure", [{ serverName: "github", envName: "BAD NAME", authValue: "private-token" }])).rejects.toThrow("Invalid environment");
});
