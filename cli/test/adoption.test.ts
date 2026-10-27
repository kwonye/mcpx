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

it("adopts a registered native Claude bundle while keeping its native loader path", async () => {
  const env = setupTempEnv("adopt-plugin-");
  try {
    const source = path.join(env.root, ".claude/plugins/cache/market/review/1");
    fs.mkdirSync(path.join(source, ".claude-plugin"), { recursive: true });
    write(path.join(source, ".claude-plugin/plugin.json"), { name: "review", version: "1" });
    fs.mkdirSync(path.join(source, "skills/review"), { recursive: true });
    fs.writeFileSync(path.join(source, "skills/review/SKILL.md"), "---\nname: review\ndescription: Review code\n---\n# Review");
    write(path.join(env.root, ".claude/plugins/installed_plugins.json"), { version: 2, plugins: { "review@market": [{ scope: "user", installPath: source }] } });
    const plan = planAdoption(["claude"]);
    expect(plan.items[0].kind).toBe("package");
    const operation = await applyAdoption(plan);
    expect(fs.lstatSync(source).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(source, "skills/review/SKILL.md"), "utf8")).toContain("Review code");
    expect(Object.values(loadConfig().packages ?? {})).toHaveLength(1);
    rollbackOperation(operation.id);
    expect(fs.lstatSync(source).isDirectory()).toBe(true);
  } finally { env.restore(); }
});

it("verifies a real stdio upstream before replacing its native Pi entry", async () => {
  const env = setupTempEnv("adopt-stdio-");
  try {
    const file = path.join(env.root, ".pi/agent/mcp.json");
    write(file, { mcpServers: { echo: { command: "node", args: [path.resolve(import.meta.dir, "fixtures/mock-stdio-mcp-server.cjs")] } } });
    await applyAdoption(planAdoption(["pi"]));
    expect(JSON.parse(fs.readFileSync(file, "utf8")).mcpServers.echo__mcpx.url).toContain("upstream=echo");
  } finally { env.restore(); }
});

it("updates a managed local Pi package, honors pinning, and shares its skills with another harness", async () => {
  const env = setupTempEnv("adopt-package-update-");
  try {
    const source = path.join(env.root, "package-source");
    fs.mkdirSync(path.join(source, "skills/review"), { recursive: true });
    fs.mkdirSync(path.join(source, "skills/obsolete"), { recursive: true });
    fs.mkdirSync(path.join(source, "skills/locally-edited"), { recursive: true });
    write(path.join(source, "package.json"), { name: "example-package", pi: { skills: ["./skills"] } });
    const skill = path.join(source, "skills/review/SKILL.md");
    fs.writeFileSync(skill, "---\nname: review\ndescription: Review code\n---\n# Version one");
    fs.writeFileSync(path.join(source, "skills/obsolete/SKILL.md"), "---\nname: obsolete\ndescription: Removed skill\n---\n# Remove me");
    fs.writeFileSync(path.join(source, "skills/locally-edited/SKILL.md"), "---\nname: locally-edited\ndescription: Local edit\n---\n# Managed version");
    write(path.join(env.root, ".pi/agent/settings.json"), { packages: [source] });
    write(path.join(env.root, ".cursor/mcp.json"), { mcpServers: {} });
    await applyAdoption(planAdoption(["pi"]));
    let config = loadConfig();
    const pkg = Object.values(config.packages!)[0];
    expect(fs.readFileSync(path.join(env.root, ".cursor/skills/package-source/review/SKILL.md"), "utf8")).toContain("Version one");
    const obsoleteProjection = path.join(env.root, ".cursor/skills/package-source/obsolete");
    expect(fs.lstatSync(obsoleteProjection).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(obsoleteProjection, "SKILL.md"), "utf8")).toContain("Remove me");
    const driftedProjection = path.join(env.root, ".cursor/skills/package-source/locally-edited");
    fs.rmSync(driftedProjection, { recursive: true, force: true });
    fs.mkdirSync(driftedProjection, { recursive: true });
    fs.writeFileSync(path.join(driftedProjection, "SKILL.md"), "# User edit");
    const unownedProjection = path.join(env.root, ".cursor/skills/local-notes/SKILL.md");
    fs.mkdirSync(path.dirname(unownedProjection), { recursive: true });
    fs.writeFileSync(unownedProjection, "# Unowned content");
    config.packages![pkg.id].pinned = true;
    saveConfig(config);
    fs.writeFileSync(skill, "---\nname: review\ndescription: Review code\n---\n# Version two");
    expect(planAdoption(["pi"]).items.find(item => item.kind === "package")?.action).toBe("conflict");
    config = loadConfig(); config.packages![pkg.id].pinned = false; saveConfig(config);
    fs.rmSync(path.join(source, "skills/obsolete"), { recursive: true, force: true });
    fs.rmSync(path.join(source, "skills/locally-edited"), { recursive: true, force: true });
    const update = await applyAdoption(planAdoption(["pi"]));
    const updated = loadConfig().packages![pkg.id];
    expect(updated.root).not.toBe(pkg.root);
    expect(fs.readFileSync(path.join(updated.root, "skills/review/SKILL.md"), "utf8")).toContain("Version two");
    expect(() => fs.lstatSync(obsoleteProjection)).toThrow();
    const cursorManifest = JSON.parse(fs.readFileSync(path.join(env.root, ".cursor/skills/mcpx-skills.json"), "utf8"));
    expect(cursorManifest.paths).not.toContain("package-source/obsolete");
    expect(cursorManifest.paths).toContain("package-source/locally-edited");
    expect(fs.readFileSync(path.join(driftedProjection, "SKILL.md"), "utf8")).toBe("# User edit");
    expect(fs.readFileSync(unownedProjection, "utf8")).toBe("# Unowned content");
    rollbackOperation(update.id);
    expect(loadConfig().packages![pkg.id].root).toBe(pkg.root);
    expect(fs.lstatSync(obsoleteProjection).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(obsoleteProjection, "SKILL.md"), "utf8")).toContain("Remove me");
    expect(fs.readFileSync(path.join(driftedProjection, "SKILL.md"), "utf8")).toBe("# User edit");
    expect(fs.readFileSync(unownedProjection, "utf8")).toBe("# Unowned content");
  } finally { env.restore(); }
});

it("tracks projected Pi package MCP servers across updates without claiming same-prefix servers or leaking project scope", async () => {
  const env = setupTempEnv("adopt-pi-package-mcp-");
  try {
    const projectPath = path.join(env.root, "project");
    const projectPi = path.join(projectPath, ".pi");
    const projectId = `pi@${path.resolve(projectPath)}`;
    const source = path.join(projectPath, "native-package");
    const projectScopeSuffix = sha256(path.resolve(projectPath)).slice(0, 8);
    const projectServerId = (name: string) => `native-package__${name}__${projectScopeSuffix}`;
    const projectMcp = path.join(projectPi, "mcp.json");
    const settingsPath = path.join(projectPi, "settings.json");
    const globalMcp = path.join(env.root, ".pi/agent/mcp.json");

    const config = defaultConfig();
    registerProject(config, projectPath, "project");
    config.harnesses ??= {};
    config.harnesses[projectId] = { mode: "selected" };
    config.servers["native-package__personal"] = { transport: "http", url: "https://personal.example/mcp" };
    saveConfig(config);

    write(globalMcp, { mcpServers: {} });
    write(settingsPath, { packages: [source] });
    write(path.join(source, ".mcp.json"), { mcpServers: {
      active: { url: "https://old.example/mcp" },
      removed: { url: "https://removed.example/mcp" },
    } });
    write(projectMcp, { mcpServers: {} });

    const noVerify = async () => {};
    await applyAdoption(planAdoption([projectId]), undefined, noVerify);

    let adopted = loadConfig();
    let pkg = Object.values(adopted.packages ?? {})[0];
    expect(pkg.servers).toEqual([projectServerId("active"), projectServerId("removed")]);
    expect(adopted.servers[projectServerId("active")].scope).toBe(projectPath);
    expect(adopted.servers[projectServerId("removed")].scope).toBe(projectPath);
    expect(adopted.packages![pkg.id].servers).not.toContain("native-package__personal");
    const projectedSettings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const projectedLoadRoot = typeof projectedSettings.packages[0] === "string" ? projectedSettings.packages[0] : projectedSettings.packages[0].source;
    expect(projectedLoadRoot.includes(`${path.sep}projections${path.sep}`)).toBe(true);

    write(path.join(source, ".mcp.json"), { mcpServers: {
      active: { url: "https://updated.example/mcp" },
    } });
    const updatePlan = planAdoption([projectId]);
    expect(updatePlan.items.find(item => item.kind === "package")?.action).toBe("import");
    await applyAdoption(updatePlan, undefined, noVerify);

    adopted = loadConfig();
    pkg = adopted.packages![pkg.id];
    expect(pkg.servers).toEqual([projectServerId("active")]);
    expect(adopted.servers[projectServerId("active")].url).toBe("https://updated.example/mcp");
    expect(adopted.servers[projectServerId("active")].scope).toBe(projectPath);
    expect(adopted.servers[projectServerId("removed")]).toBeUndefined();
    expect(adopted.servers["native-package__personal"]).toBeDefined();

    const projectEntries = JSON.parse(fs.readFileSync(projectMcp, "utf8")).mcpServers;
    expect(projectEntries[`${projectServerId("active")}__mcpx`]).toBeDefined();
    expect(projectEntries[`${projectServerId("removed")}__mcpx`]).toBeUndefined();
    const globalEntries = JSON.parse(fs.readFileSync(globalMcp, "utf8")).mcpServers;
    expect(globalEntries["native-package__personal__mcpx"]).toBeDefined();
    expect(globalEntries[`${projectServerId("active")}__mcpx`]).toBeUndefined();
  } finally { env.restore(); }
});

it("keeps the same Pi package source separate between global and project scope", async () => {
  const env = setupTempEnv("adopt-pi-package-scope-collision-");
  try {
    const projectPath = path.join(env.root, "project");
    const projectId = `pi@${path.resolve(projectPath)}`;
    const source = path.join(env.root, "shared-package");
    const globalMcp = path.join(env.root, ".pi/agent/mcp.json");
    const globalSettings = path.join(env.root, ".pi/agent/settings.json");
    const projectMcp = path.join(projectPath, ".pi/mcp.json");
    const projectSettings = path.join(projectPath, ".pi/settings.json");
    const projectScopeSuffix = sha256(path.resolve(projectPath)).slice(0, 8);
    const globalServerId = "shared-package__service";
    const projectServerId = `${globalServerId}__${projectScopeSuffix}`;

    const config = defaultConfig();
    registerProject(config, projectPath, "project");
    config.harnesses ??= {};
    config.harnesses[projectId] = { mode: "selected" };
    saveConfig(config);
    write(globalMcp, { mcpServers: {} });
    write(projectMcp, { mcpServers: {} });
    write(globalSettings, { packages: [source] });
    write(projectSettings, { packages: [source] });
    write(path.join(source, ".mcp.json"), { mcpServers: { service: { url: "https://service.example/mcp" } } });

    const plan = planAdoption(["pi", projectId]);
    expect(plan.items.filter(item => item.kind === "package")).toHaveLength(2);
    await applyAdoption(plan, undefined, async () => {});

    const adopted = loadConfig();
    const packages = Object.values(adopted.packages ?? {});
    const globalPackage = packages.find(pkg => pkg.scope === undefined)!;
    const projectPackage = packages.find(pkg => pkg.scope === projectPath)!;
    expect(globalPackage.id).not.toBe(projectPackage.id);
    expect(globalPackage.identity).not.toBe(projectPackage.identity);
    expect(globalPackage.servers).toEqual([globalServerId]);
    expect(projectPackage.servers).toEqual([projectServerId]);
    expect(adopted.servers[globalServerId].scope).toBeUndefined();
    expect(adopted.servers[projectServerId].scope).toBe(projectPath);

    const globalEntries = JSON.parse(fs.readFileSync(globalMcp, "utf8")).mcpServers;
    const projectEntries = JSON.parse(fs.readFileSync(projectMcp, "utf8")).mcpServers;
    expect(globalEntries[`${globalServerId}__mcpx`]).toBeDefined();
    expect(globalEntries[`${projectServerId}__mcpx`]).toBeUndefined();
    expect(projectEntries[`${projectServerId}__mcpx`]).toBeDefined();
    expect(projectEntries[`${globalServerId}__mcpx`]).toBeDefined();
  } finally { env.restore(); }
});

it("rejects Pi package MCP names that collide after normalization", async () => {
  const env = setupTempEnv("adopt-pi-package-collision-");
  try {
    const source = path.join(env.root, "native-package");
    const settingsPath = path.join(env.root, ".pi/agent/settings.json");
    const settings = { packages: [source] };
    write(settingsPath, settings);
    write(path.join(source, ".mcp.json"), { mcpServers: {
      "foo-bar": { url: "https://one.example/mcp" },
      "foo bar": { url: "https://two.example/mcp" },
    } });

    await expect(applyAdoption(planAdoption(["pi"]), undefined, async () => {})).rejects.toThrow("collide after normalization");
    expect(JSON.parse(fs.readFileSync(settingsPath, "utf8"))).toEqual(settings);
    expect(loadConfig().packages ?? {}).toEqual({});
  } finally { env.restore(); }
});

it("explains why remote Pi package sources cannot be adopted", () => {
  const env = setupTempEnv("adopt-pi-remote-package-");
  try {
    write(path.join(env.root, ".pi/agent/mcp.json"), { mcpServers: {} });
    write(path.join(env.root, ".pi/agent/settings.json"), { packages: ["https://registry.example/package.tgz?token=private-value"] });

    const plan = planAdoption(["pi"]);
    expect(plan.errors.join(" ")).toContain("remote or registry package source requires a resolved self-contained local source before adoption");
    expect(JSON.stringify(plan)).not.toContain("registry.example");
    expect(JSON.stringify(plan)).not.toContain("private-value");
    expect(plan.items).toHaveLength(0);
  } finally { env.restore(); }
});
