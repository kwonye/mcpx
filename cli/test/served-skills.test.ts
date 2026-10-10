import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { setupTempEnv } from "./helpers.js";
import { defaultConfig, saveConfig } from "../src/core/config.js";
import { saveSkill } from "../src/core/skills.js";
import { getSkillsDir } from "../src/core/paths.js";
import { listServedSkills, readServedSkill } from "../src/core/served-skills.js";
import { createGatewayServer } from "../src/gateway/server.js";
import { SecretsManager } from "../src/core/secrets.js";
import { MCP_V2_PROTOCOL_VERSION } from "../src/core/mcp-v2.js";
import { consumerToken } from "../src/core/consumers.js";

it("publishes complete skill manifests and refuses traversal and escaping links", () => {
  const env = setupTempEnv("served-skills-");
  try {
    saveSkill("review", "---\nname: review\ndescription: Review code\nmetadata:\n  author: team\n---\n# Review");
    fs.mkdirSync(path.join(getSkillsDir(), "review/references"));
    fs.writeFileSync(path.join(getSkillsDir(), "review/references/guide.md"), "A guide");
    const result = listServedSkills(defaultConfig());
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].resources).toHaveLength(2);
    expect(result.skills[0].resources[0].digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.skills[0].frontmatter.metadata).toEqual({ author: "team" });
    expect(() => readServedSkill(defaultConfig(), "skill://mcpx/review/review/../../outside.txt")).toThrow();
    fs.writeFileSync(path.join(env.root, "outside.txt"), "private");
    fs.symlinkSync(path.join(env.root, "outside.txt"), path.join(getSkillsDir(), "review/escape.txt"));
    expect(listServedSkills(defaultConfig()).skills).toHaveLength(0);
  } finally { env.restore(); }
});

it("serves the official extension over the gateway and enforces project consumer scope", async () => {
  const env = setupTempEnv("skills-http-");
  const config = defaultConfig();
  saveSkill("private", "---\nname: private\ndescription: Project workflow\n---\n# Private");
  config.origins = { source: { id: "private", kind: "skill", harness: "pi@/example", source: "/example/.pi/skills/private", nativeKey: "private", fingerprint: "example", operationId: "example" } };
  const globalToken = consumerToken(config, "pi");
  const projectToken = consumerToken(config, "pi@/example", "/example");
  saveConfig(config);
  const server = createGatewayServer({ port: 0, expectedToken: "admin", secrets: new SecretsManager() });
  if (!server.listening) await new Promise(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const invoke = async (token: string, method: string, params: Record<string, unknown> = {}) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": MCP_V2_PROTOCOL_VERSION, "mcp-method": method, ...(params.uri ? { "mcp-name": String(params.uri) } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: { "io.modelcontextprotocol/protocolVersion": MCP_V2_PROTOCOL_VERSION, "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} } } }) });
    return response.json() as Promise<any>;
  };
  try {
    expect((await invoke(globalToken, "skills/list")).result.skills).toHaveLength(0);
    const project = await invoke(projectToken, "skills/list");
    expect(project.result.skills).toHaveLength(1);
    const uri = project.result.skills[0].uri;
    expect((await invoke(projectToken, "skills/get", { uri })).result.skill.uri).toBe(uri);
    expect((await invoke(globalToken, "resources/read", { uri })).error).toBeDefined();
    expect((await invoke(projectToken, "resources/read", { uri })).result.contents[0].text).toContain("# Private");
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); env.restore(); }
});
