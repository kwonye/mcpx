import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { setupTempEnv } from "./helpers.js";
import { planAdoption, applyAdoption } from "../src/core/adoption.js";
import { loadConfig, saveConfig, defaultConfig } from "../src/core/config.js";
import { getConfigPath, getManagedIndexPath } from "../src/core/paths.js";
import { registerProject } from "../src/core/registry.js";
import { rollbackOperation, snapshot, snapshotHash, applyWrites, textSnapshot } from "../src/core/operations.js";
import { resolveConsumer } from "../src/core/consumers.js";
import { sha256 } from "../src/util/fs.js";

function write(file: string, value: unknown) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); }
describe("recoverable native adoption", () => {
  it("scans without writes, persists ownership and credentials, cuts over Pi, and undoes without clobbering unrelated edits", async () => {
    const env = setupTempEnv("adopt-pi-");
    try {
      const file = path.join(env.root, ".pi/agent/mcp.json");
      write(file, { extra: "preserve", mcpServers: { docs: { url: "https://example.com/mcp", headers: { Authorization: "Bearer private-value" } } } });
      const before = snapshotHash(snapshot(env.root));
      const plan = planAdoption(["pi"]);
      expect(snapshotHash(snapshot(env.root))).toBe(before);
      expect(JSON.stringify(plan)).not.toContain("private-value");
      expect(plan.items).toHaveLength(1);
      const result = await applyAdoption(plan, undefined, async () => { expect(fs.readFileSync(file, "utf8")).toContain("private-value"); });
      const config = loadConfig();
      expect(config.servers.docs).toBeDefined();
      expect(fs.readFileSync(getConfigPath(), "utf8")).not.toContain("private-value");
      const native = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(native.mcpServers.docs).toBeUndefined();
      const managed = native.mcpServers.docs__mcpx;
      expect(managed.url).toContain("upstream=docs");
      expect(resolveConsumer(config, managed.headers.Authorization.replace("Bearer ", ""))?.id).toBe("pi");
      native.newSetting = true;
      fs.writeFileSync(file, JSON.stringify(native));
      rollbackOperation(result.id);
      const restored = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(restored.newSetting).toBe(true);
      expect(restored.mcpServers.docs.headers.Authorization).toBe("Bearer private-value");
      expect(restored.mcpServers.docs__mcpx).toBeUndefined();
    } finally { env.restore(); }
  });
  it("rejects stale plans before deleting any source", async () => {
    const env = setupTempEnv("adopt-stale-");
    try {
      const file = path.join(env.root, ".pi/agent/mcp.json");
      write(file, { mcpServers: { docs: { url: "https://example.com/mcp" } } });
      const plan = planAdoption(["pi"]);
      write(file, { mcpServers: { docs: { url: "https://changed.example/mcp" } } });
      await expect(applyAdoption(plan)).rejects.toThrow("changed");
      expect(fs.readFileSync(file, "utf8")).toContain("changed.example");
    } finally { env.restore(); }
  });
  it("moves complete skill directories and can restore their native installation", async () => {
    const env = setupTempEnv("adopt-skill-");
    try {
      const skill = path.join(env.root, ".pi/agent/skills/review");
      fs.mkdirSync(path.join(skill, "scripts"), { recursive: true });
      fs.writeFileSync(path.join(skill, "SKILL.md"), "---\nname: review\ndescription: Review code\n---\n# Review");
      fs.writeFileSync(path.join(skill, "scripts/check.sh"), "echo check");
      const plan = planAdoption(["pi"]);
      expect(plan.items[0].kind).toBe("skill");
      const operation = await applyAdoption(plan);
      expect(fs.lstatSync(skill).isSymbolicLink()).toBe(true);
      expect(fs.readFileSync(path.join(skill, "scripts/check.sh"), "utf8")).toBe("echo check");
      rollbackOperation(operation.id);
      expect(fs.lstatSync(skill).isDirectory()).toBe(true);
    } finally { env.restore(); }
  });
  it("deduplicates different labels for identical servers but preserves different accounts", () => {
    const env = setupTempEnv("adopt-identity-");
    try {
      write(path.join(env.root, ".pi/agent/mcp.json"), { mcpServers: { first: { url: "https://example.com/mcp" }, second: { url: "https://example.com/mcp" }, account: { url: "https://example.com/mcp", headers: { Authorization: "different" } } } });
      const plan = planAdoption(["pi"]);
      expect(plan.items.map(item => item.action)).toEqual(["import", "reuse", "import"]);
      expect(plan.items[0].canonicalId).toBe(plan.items[1].canonicalId);
    } finally { env.restore(); }
  });
  it("never overwrites a later edit during undo", () => {
    const env = setupTempEnv("undo-edits-");
    try {
      const file = path.join(env.root, "data.txt");
      fs.writeFileSync(file, "before");
      const operation = applyWrites("example", [{ path: file, before: snapshot(file), after: textSnapshot("after") }]);
      fs.writeFileSync(file, "later user edit");
      expect(() => rollbackOperation(operation.id)).toThrow("Local edits");
      expect(fs.readFileSync(file, "utf8")).toBe("later user edit");
    } finally { env.restore(); }
  });
});

it("keeps the native server when its managed replacement fails verification", async () => {
  const env = setupTempEnv("adopt-verification-");
  try {
    const file = path.join(env.root, ".pi/agent/mcp.json");
    write(file, { mcpServers: { docs: { url: "https://example.com/mcp" } } });
    const before = fs.readFileSync(file, "utf8");
    await expect(applyAdoption(planAdoption(["pi"]), undefined, async () => { throw new Error("verification failed"); })).rejects.toThrow("verification failed");
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(loadConfig().servers.docs).toBeUndefined();
  } finally { env.restore(); }
});

for (const [label, targetPath, contents] of [
  ["configuration", getConfigPath, { externalEdit: true }],
  ["managed index", getManagedIndexPath, { schemaVersion: 1, managed: {}, externalEdit: true }],
] as const) {
  it(`preserves a ${label} edit made during upstream verification`, async () => {
    const env = setupTempEnv(`adopt-${label.replaceAll(" ", "-")}-race-`);
    try {
      const nativePath = path.join(env.root, ".pi/agent/mcp.json");
      write(nativePath, { mcpServers: { docs: { url: "https://example.com/mcp" } } });
      const nativeBefore = fs.readFileSync(nativePath, "utf8");
      const target = targetPath();
      const plan = planAdoption(["pi"]);

      await expect(applyAdoption(plan, undefined, async () => {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, JSON.stringify(contents));
      })).rejects.toThrow("Configuration changed since planning");

      expect(JSON.parse(fs.readFileSync(target, "utf8")).externalEdit).toBe(true);
      expect(fs.readFileSync(nativePath, "utf8")).toBe(nativeBefore);
      expect(loadConfig().servers.docs).toBeUndefined();
    } finally { env.restore(); }
  });
}

it("verifies a real stdio upstream before replacing its native Pi entry", async () => {
  const env = setupTempEnv("adopt-stdio-");
  try {
    const file = path.join(env.root, ".pi/agent/mcp.json");
    write(file, { mcpServers: { echo: { command: "node", args: [path.resolve(import.meta.dir, "fixtures/mock-stdio-mcp-server.cjs")] } } });
    await applyAdoption(planAdoption(["pi"]));
    expect(JSON.parse(fs.readFileSync(file, "utf8")).mcpServers.echo__mcpx.url).toContain("upstream=echo");
  } finally { env.restore(); }
});

it("does not adopt vendor packages or retire their native loader registrations", () => {
  const env = setupTempEnv("unsupported-native-packages-");
  try {
    const settings = path.join(env.root, ".pi/agent/settings.json");
    write(settings, { packages: ["npm:vendor-package", "./local-vendor-package"] });
    const registry = path.join(env.root, ".claude/plugins/installed_plugins.json");
    write(registry, { plugins: { "vendor@market": [{ installPath: env.root }] } });
    const plan = planAdoption(["pi", "claude"]);
    expect(plan.items.filter(item => item.kind === "package")).toEqual([]);
    expect(JSON.parse(fs.readFileSync(settings, "utf8")).packages).toHaveLength(2);
    expect(fs.existsSync(registry)).toBe(true);
  } finally { env.restore(); }
});
