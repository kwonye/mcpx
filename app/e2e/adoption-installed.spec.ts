import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createSandbox, cleanupSandbox, closeApp, openDashboardWindow } from "./helpers";

const executablePath = process.env.MCPX_INSTALLED_APP_PATH;
test.skip(!executablePath, "Set MCPX_INSTALLED_APP_PATH to the installed mcpx-dev executable.");
test("installed app saves one stdio credential and syncs two harnesses without copying it", async () => {
  test.setTimeout(60000);
  const sandbox = createSandbox();
  const home = sandbox.env.HOME!;
  const piPath = path.join(home, ".pi/agent/mcp.json");
  const cursorPath = path.join(home, ".cursor/mcp.json");
  const upstreamPath = path.join(home, "authenticated-upstream.cjs");
  fs.writeFileSync(upstreamPath, `if (process.env.API_KEY !== "installed-fixture-private-value") throw new Error("Upstream credential required");\nrequire(${JSON.stringify(path.resolve(__dirname, "../../cli/test/fixtures/mock-stdio-mcp-server.cjs"))});\n`);
  for (const target of [piPath, cursorPath]) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ mcpServers: {} }));
  }
  const app = await electron.launch({ executablePath, args: ["--dev", ...sandbox.launchArgs], env: sandbox.env });
  try {
    const window = await openDashboardWindow(app);
    await window.evaluate(() => document.fonts.load('24px "Material Symbols Outlined Variable"'));
    expect(await window.evaluate(() => document.fonts.check('24px "Material Symbols Outlined Variable"'))).toBe(true);
    const iconBounds = await window.locator(".nav-button .material-symbols-outlined").first().boundingBox();
    expect(iconBounds!.width).toBeLessThan(40);
    await expect(window.locator('link[href*="fonts.googleapis.com"]')).toHaveCount(0);
    await window.evaluate(async spec => { await window.mcpx.addServer("echo", spec); }, {
      transport: "stdio", command: process.execPath,
      args: [upstreamPath]
    });
    await window.getByRole("button", { name: /Servers$/ }).click();
    await expect(window.getByRole("heading", { name: "echo", exact: true })).toBeVisible();
    await window.evaluate(() => window.mcpx.requestAuth("echo"));
    await window.getByLabel("Environment variable").fill("API_KEY");
    await window.getByLabel("Auth value").fill("installed-fixture-private-value");
    await window.getByRole("button", { name: "Save token" }).click();
    await expect(window.getByRole("dialog", { name: "Sign in to echo" })).not.toBeVisible();
    const config = fs.readFileSync(path.join(sandbox.env.MCPX_CONFIG_HOME!, "mcpx/config.json"), "utf8");
    expect(JSON.parse(config).servers.echo.env.API_KEY).toBe("secret://auth_echo_env_api_key");
    for (const content of [config, fs.readFileSync(piPath, "utf8"), fs.readFileSync(cursorPath, "utf8")]) {
      expect(content).not.toContain("installed-fixture-private-value");
    }
    const pi = JSON.parse(fs.readFileSync(piPath, "utf8")).mcpServers.echo__mcpx;
    const cursor = JSON.parse(fs.readFileSync(cursorPath, "utf8")).mcpServers["echo (mcpx)"];
    expect(pi.headers.Authorization).not.toBe(cursor.headers.Authorization);
    expect(pi.url).toBe(cursor.url);
    for (const entry of [pi, cursor]) {
      const response = await fetch(entry.url, {
        method: "POST",
        headers: { ...entry.headers, accept: "application/json, text/event-stream", "content-type": "application/json", "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "echo" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: { text: "authorized through the shared gateway" }, _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "installed-auth-test", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} } } })
      });
      expect((await response.json() as any).result.content[0].text).toBe("authorized through the shared gateway");
    }
    const before = pi.headers.Authorization;
    await window.evaluate(() => window.mcpx.management.sync());
    expect(JSON.parse(fs.readFileSync(piPath, "utf8")).mcpServers.echo__mcpx.headers.Authorization).toBe(before);
    await window.getByRole("button", { name: /Harnesses$/ }).click();
    await expect(window.getByText("Synchronized", { exact: true })).toHaveCount(2);
    await window.screenshot({ path: "/tmp/mcpx-shared-credentials.png" });
  } finally { await closeApp(app); cleanupSandbox(sandbox); }
});

test("installed app adopts native integrations, serves MCP, and undoes the cutover", async () => {
  test.setTimeout(90000);
  const sandbox = createSandbox();
  const home = sandbox.env.HOME!;
  const nativePath = path.join(home, ".pi/agent/mcp.json");
  const skillPath = path.join(home, ".pi/agent/skills/review");
  fs.mkdirSync(path.join(skillPath, "references"), { recursive: true });
  fs.writeFileSync(path.join(skillPath, "SKILL.md"), "---\nname: review\ndescription: Review a change carefully\n---\n# Review");
  fs.writeFileSync(path.join(skillPath, "references/guide.md"), "Keep this supporting file.");
  fs.writeFileSync(nativePath, JSON.stringify({ mcpServers: { echo: { command: process.execPath, args: [path.resolve(__dirname, "../../cli/test/fixtures/mock-stdio-mcp-server.cjs")], env: { API_KEY: "fixture-private-value" } } }, unrelated: "keep" }));
  const app = await electron.launch({ executablePath, args: ["--dev", ...sandbox.launchArgs], env: sandbox.env });
  try {
    const window = await openDashboardWindow(app);
    await window.getByRole("button", { name: /Overview$/ }).click();
    await expect(window.getByRole("heading", { name: "Everything, connected." })).toBeVisible();
    await window.screenshot({ path: "/tmp/mcpx-overview.png" });
    await window.getByRole("button", { name: /Scan existing installs/ }).click();
    await expect(window.getByRole("dialog")).toBeVisible();
    await expect(window.getByRole("checkbox", { name: "Adopt echo from pi" })).toBeChecked();
    await window.screenshot({ path: "/tmp/mcpx-adoption-preview.png" });
    await window.getByRole("button", { name: "Adopt selected" }).click();
    await expect(window.getByRole("dialog")).not.toBeVisible({ timeout: 20000 });
    const managed = JSON.parse(fs.readFileSync(nativePath, "utf8"));
    expect(managed.mcpServers.echo).toBeUndefined();
    expect(fs.lstatSync(skillPath).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(skillPath, "references/guide.md"), "utf8")).toContain("supporting file");
    const entry = managed.mcpServers.echo__mcpx;
    const response = await fetch(entry.url, { method: "POST", headers: { ...entry.headers, accept: "application/json, text/event-stream", "content-type": "application/json", "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "echo" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: { text: "through installed daemon" }, _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "installed-e2e", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} } } }) });
    expect((await response.json() as any).result.content[0].text).toBe("through installed daemon");
    const config = fs.readFileSync(path.join(sandbox.env.MCPX_CONFIG_HOME!, "mcpx/config.json"), "utf8");
    expect(config).not.toContain("fixture-private-value");
    managed.addedLater = true;
    fs.writeFileSync(nativePath, JSON.stringify(managed));
    await window.getByRole("button", { name: /Harnesses$/ }).click();
    await window.screenshot({ path: "/tmp/mcpx-harnesses.png" });
    await window.getByRole("button", { name: /Activity$/ }).click();
    await window.getByRole("button", { name: /^Undo$/ }).click();
    await window.getByRole("button", { name: "Undo operation" }).click();
    await expect(window.getByText("Operation undone.")).toBeVisible({ timeout: 15000 });
    const restored = JSON.parse(fs.readFileSync(nativePath, "utf8"));
    expect(restored.mcpServers.echo.command).toBe(process.execPath);
    expect(restored.addedLater).toBe(true);
    expect(fs.lstatSync(skillPath).isDirectory()).toBe(true);
    await window.screenshot({ path: "/tmp/mcpx-activity.png" });
  } finally { await closeApp(app); cleanupSandbox(sandbox); }
});
