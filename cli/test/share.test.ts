import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { setupTempEnv } from "./helpers.js";
import { saveSkill } from "../src/core/skills.js";
import { defaultConfig, saveConfig } from "../src/core/config.js";
import { exportEnvironment, importEnvironment } from "../src/core/share.js";
import { installSkillFromSource, getSkill, customizeSkill, rollbackSkill } from "../src/core/index.js";

describe("portable environments", () => {
  it("installs complete skill directories and supports customization", async () => {
    const env = setupTempEnv("skill-package-");
    const source = path.join(env.root, "source-skill");
    fs.mkdirSync(path.join(source, "references"), { recursive: true });
    fs.writeFileSync(path.join(source, "SKILL.md"), "---\nname: packaged\ndescription: Packaged\n---\nBody\n");
    fs.writeFileSync(path.join(source, "references", "guide.md"), "Guide");
    const installed = await installSkillFromSource(source);
    expect(installed.readOnly).toBe(true);
    expect(fs.existsSync(path.join(installed.root!, "references", "guide.md"))).toBe(true);
    const authored = customizeSkill("packaged", "packaged-authored");
    expect(authored.readOnly).not.toBe(true);
    expect(getSkill("packaged-authored")?.content).toContain("Packaged");
    env.restore();
  });

  it("exports complete skills and replaces credentials with recipient inputs", async () => {
    const env = setupTempEnv("share-export-");
    saveSkill("reviewer", "---\nname: reviewer\ndescription: Reviews code\n---\nRead references when needed.");
    const config = defaultConfig();
    config.servers.docs = { transport: "http", url: "https://example.test/mcp", headers: { Authorization: "secret://docs-token", "X-Team": "private" } };
    saveConfig(config);
    const destination = path.join(env.root, "bundle");
    const result = exportEnvironment(destination);
    expect(result.environment.skills.map((entry) => entry.id)).toEqual(["reviewer"]);
    expect(result.environment.inputs.map((input) => input.name)).toContain("server.docs.header.X-Team");
    expect(JSON.parse(fs.readFileSync(path.join(destination, "mcpx.environment.lock.json"), "utf8")).manifestSha256).toHaveLength(64);
    expect(fs.existsSync(path.join(destination, "packages", "skills", "reviewer", "SKILL.md"))).toBe(true);
    env.restore();
  });

  it("validates locked imports and preserves the recipient input placeholder when absent", async () => {
    const env = setupTempEnv("share-import-");
    const source = path.join(env.root, "bundle");
    fs.mkdirSync(path.join(source, "packages", "skills", "one"), { recursive: true });
    fs.writeFileSync(path.join(source, "packages", "skills", "one", "SKILL.md"), "---\nname: one\ndescription: One\n---\nBody\n");
    fs.writeFileSync(path.join(source, "mcpx.environment.json"), JSON.stringify({ version: 1, generatedBy: "mcpx", servers: { one: { transport: "stdio", command: "tool", env: { TOKEN: "{{input:token}}" } } }, skills: [{ id: "one", kind: "skill", path: "packages/skills/one" }], plugins: [], clients: [], inputs: [{ name: "token" }] }, null, 2));
    const { createHash } = await import("node:crypto");
    const treeHash = createHash("sha256").update("packages/skills/one").update("SKILL.md").update(fs.readFileSync(path.join(source, "packages", "skills", "one", "SKILL.md"))).digest("hex");
    const manifestSha256 = createHash("sha256").update(fs.readFileSync(path.join(source, "mcpx.environment.json"))).digest("hex");
    fs.writeFileSync(path.join(source, "mcpx.environment.lock.json"), JSON.stringify({ version: 1, mcpxCompatibility: "1", manifestSha256, packages: { "skill:one": { sha256: treeHash } } }));
    const result = await importEnvironment(source, { locked: false, dryRun: true });
    expect(result.missingInputs).toEqual(["token"]);
    env.restore();
  });
});
