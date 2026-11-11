import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { CLIENT_IDS, detectInstalledClients, getAdapter, getAdapters, type HostContext } from "../src/adapters/index.js";
import { findOnPath } from "../src/adapters/host.js";
import { defaultConfig, saveConfig } from "../src/core/config.js";
import { syncAllClients } from "../src/core/sync.js";
import { SecretsManager } from "../src/core/secrets.js";
import type { ClientId } from "../src/types.js";
import { installClients, isolatedHost, setupTempEnv } from "./helpers.js";

function fakeHost(platform: NodeJS.Platform, home: string, existing: string[] = [], env: Record<string, string> = {}): Partial<HostContext> {
  const present = new Set(existing);
  return { platform, home, env, exists: (p) => present.has(p) };
}

function configPaths(host: Partial<HostContext>): Record<string, string | null> {
  return Object.fromEntries(getAdapters(host).map((adapter) => [adapter.id, adapter.detectConfigPath()]));
}

const WIN_HOME = "C:\\Users\\me";
const WIN_ENV = {
  APPDATA: "C:\\Users\\me\\AppData\\Roaming",
  LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local"
};

describe("client catalogue paths", () => {
  it("covers every client id", () => {
    expect(CLIENT_IDS).toEqual([
      "claude", "claude-desktop", "codex", "cursor", "cline", "opencode", "kiro",
      "vscode", "vscode-insiders", "qwen", "openclaw", "hermes"
    ]);
  });

  it("resolves Windows paths for every client", () => {
    expect(configPaths(fakeHost("win32", WIN_HOME, [], WIN_ENV))).toEqual({
      claude: "C:\\Users\\me\\.claude.json",
      "claude-desktop": "C:\\Users\\me\\AppData\\Roaming\\Claude\\claude_desktop_config.json",
      codex: "C:\\Users\\me\\.codex\\config.toml",
      cursor: "C:\\Users\\me\\.cursor\\mcp.json",
      cline: "C:\\Users\\me\\.cline\\data\\settings\\cline_mcp_settings.json",
      opencode: "C:\\Users\\me\\.config\\opencode\\opencode.json",
      kiro: "C:\\Users\\me\\.kiro\\settings\\mcp.json",
      vscode: "C:\\Users\\me\\AppData\\Roaming\\Code\\User\\mcp.json",
      "vscode-insiders": "C:\\Users\\me\\AppData\\Roaming\\Code - Insiders\\User\\mcp.json",
      qwen: "C:\\Users\\me\\.qwen\\settings.json",
      openclaw: "C:\\Users\\me\\.openclaw\\openclaw.json",
      hermes: "C:\\Users\\me\\.hermes\\config.yaml"
    });
  });

  it("falls back to %USERPROFILE%\\AppData\\Roaming when APPDATA is unset", () => {
    expect(getAdapter("vscode", fakeHost("win32", WIN_HOME))?.detectConfigPath())
      .toBe("C:\\Users\\me\\AppData\\Roaming\\Code\\User\\mcp.json");
  });

  it("resolves macOS paths", () => {
    const paths = configPaths(fakeHost("darwin", "/Users/me"));
    expect(paths["claude-desktop"]).toBe("/Users/me/Library/Application Support/Claude/claude_desktop_config.json");
    expect(paths.vscode).toBe("/Users/me/Library/Application Support/Code/User/mcp.json");
    expect(paths["vscode-insiders"]).toBe("/Users/me/Library/Application Support/Code - Insiders/User/mcp.json");
    expect(paths.opencode).toBe("/Users/me/.config/opencode/opencode.json");
  });

  it("resolves Linux paths and honours XDG_CONFIG_HOME", () => {
    expect(configPaths(fakeHost("linux", "/home/me"))).toMatchObject({
      "claude-desktop": "/home/me/.config/Claude/claude_desktop_config.json",
      vscode: "/home/me/.config/Code/User/mcp.json",
      "vscode-insiders": "/home/me/.config/Code - Insiders/User/mcp.json",
      opencode: "/home/me/.config/opencode/opencode.json"
    });
    expect(configPaths(fakeHost("linux", "/home/me", [], { XDG_CONFIG_HOME: "/xdg" }))).toMatchObject({
      vscode: "/xdg/Code/User/mcp.json",
      opencode: "/xdg/opencode/opencode.json"
    });
  });

  it("prefers an existing legacy Cline settings file over the default location", () => {
    const legacy = "/Users/me/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json";
    expect(getAdapter("cline", fakeHost("darwin", "/Users/me", [legacy]))?.detectConfigPath()).toBe(legacy);
  });
});

describe("client install detection", () => {
  it("detects nothing on an empty machine", () => {
    for (const platform of ["darwin", "win32", "linux"] as const) {
      expect(detectInstalledClients(fakeHost(platform, platform === "win32" ? WIN_HOME : "/home/me", [], WIN_ENV))).toEqual([]);
    }
  });

  it("detects macOS clients from config dirs and app bundles", () => {
    const installed = detectInstalledClients(fakeHost("darwin", "/Users/me", [
      "/Users/me/.cursor",
      "/Applications/Claude.app",
      "/Users/me/Applications/Visual Studio Code - Insiders.app",
      "/Users/me/.claude.json"
    ]));
    expect(installed.sort()).toEqual(["claude", "claude-desktop", "cursor", "vscode-insiders"]);
  });

  it("detects Windows clients from %APPDATA% and %LOCALAPPDATA% install dirs", () => {
    const installed = detectInstalledClients(fakeHost("win32", WIN_HOME, [
      "C:\\Users\\me\\AppData\\Roaming\\Code",
      "C:\\Users\\me\\AppData\\Local\\AnthropicClaude",
      "C:\\Users\\me\\AppData\\Local\\Programs\\Kiro"
    ], WIN_ENV));
    expect(installed.sort()).toEqual(["claude-desktop", "kiro", "vscode"]);
  });

  it("detects Linux clients from XDG config dirs and binaries on PATH", () => {
    const installed = detectInstalledClients(fakeHost("linux", "/home/me", [
      "/home/me/.config/opencode",
      "/usr/local/bin/codex"
    ], { PATH: "/usr/bin:/usr/local/bin" }));
    expect(installed.sort()).toEqual(["codex", "opencode"]);
  });

  it("resolves binaries on PATH in-process, honouring PATHEXT on Windows", () => {
    const host = fakeHost("win32", WIN_HOME, ["C:\\tools\\claude.cmd"], { Path: "C:\\bin;C:\\tools", PATHEXT: ".EXE;.CMD" });
    expect(findOnPath({ ...host, env: host.env! } as HostContext, "claude")).toBe("C:\\tools\\claude.cmd");
    expect(detectInstalledClients(host)).toEqual(["claude"]);
  });

  it("reports what proved a client is installed", () => {
    const adapter = getAdapter("qwen", fakeHost("linux", "/home/me", ["/home/me/.qwen"]));
    expect(adapter?.detectInstallation?.()).toEqual({ installed: true, evidence: "/home/me/.qwen" });
  });
});

describe("sync only writes installed clients", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()!();
  });

  function setup(prefix: string) {
    const env = setupTempEnv(prefix);
    cleanups.push(env.restore);
    const config = defaultConfig();
    config.servers.vercel = { transport: "http", url: "https://mcp.vercel.com" };
    saveConfig(config);
    return { env, config, host: { platform: "darwin" as const, ...isolatedHost(env.root) } };
  }

  function listFiles(root: string): string[] {
    return (fs.readdirSync(root, { recursive: true }) as string[])
      .filter((entry) => fs.statSync(path.join(root, entry)).isFile());
  }

  it("creates nothing outside mcpx's own directories in an empty HOME", () => {
    const { env, config, host } = setup("mcpx-clients-empty-");

    const summary = syncAllClients(config, new SecretsManager(), { importScan: true, host });

    expect(summary.hasErrors).toBe(false);
    expect(summary.results).toHaveLength(CLIENT_IDS.length);
    for (const result of summary.results) {
      expect(result.status).toBe("SKIPPED");
      expect(result.reason).toBe("not-installed");
      expect(result.message).toContain("not installed");
      expect(result.configPath).toBeUndefined();
    }
    const outside = listFiles(env.root).filter((file) => !/^(config|data|state)\//.test(file));
    expect(outside).toEqual([]);
    expect(fs.readdirSync(env.root).filter((name) => !["config", "data", "state"].includes(name))).toEqual([]);
  });

  it("syncs installed clients and skips the rest", () => {
    const { env, config, host } = setup("mcpx-clients-partial-");
    installClients(env.root, ["cursor"]);

    const summary = syncAllClients(config, new SecretsManager(), { host });

    const byId = Object.fromEntries(summary.results.map((result) => [result.clientId, result]));
    expect(byId.cursor.status).toBe("SYNCED");
    expect(JSON.parse(fs.readFileSync(path.join(env.root, ".cursor", "mcp.json"), "utf8")).mcpServers["vercel (mcpx)"].url)
      .toContain("upstream=vercel");
    expect(byId.kiro.status).toBe("SKIPPED");
    expect(fs.existsSync(path.join(env.root, ".kiro"))).toBe(false);
    expect(summary.clientStates?.kiro?.message).toContain("not installed");
  });

  it("an explicitly named client is synced even when not detected", () => {
    const { env, config, host } = setup("mcpx-clients-explicit-");

    const summary = syncAllClients(config, new SecretsManager(), { targetClients: ["kiro"], host });

    expect(summary.results.map((result) => [result.clientId, result.status])).toEqual([["kiro", "SYNCED"]]);
    expect(fs.existsSync(path.join(env.root, ".kiro", "settings", "mcp.json"))).toBe(true);
    expect(fs.existsSync(path.join(env.root, ".cursor"))).toBe(false);
  });

  it("forceClients syncs a client without limiting the others", () => {
    const { env, config, host } = setup("mcpx-clients-force-");
    installClients(env.root, ["cursor"]);

    const summary = syncAllClients(config, new SecretsManager(), { forceClients: ["qwen" as ClientId], host });

    const synced = summary.results.filter((result) => result.status === "SYNCED").map((result) => result.clientId).sort();
    expect(synced).toEqual(["cursor", "qwen"]);
    expect(fs.existsSync(path.join(env.root, ".qwen", "settings.json"))).toBe(true);
  });

  it("does not report Cline as SYNCED when it is not installed", () => {
    const { env, config, host } = setup("mcpx-clients-cline-missing-");

    const summary = syncAllClients(config, new SecretsManager(), { host });

    const cline = summary.results.find((result) => result.clientId === "cline");
    expect(cline).toMatchObject({ status: "SKIPPED", reason: "not-installed" });
    expect(fs.existsSync(path.join(env.root, ".cline"))).toBe(false);
  });

  it("writes Cline's shared settings file when only ~/.cline exists", () => {
    const { env, config, host } = setup("mcpx-clients-cline-");
    fs.mkdirSync(path.join(env.root, ".cline"));

    const summary = syncAllClients(config, new SecretsManager(), { host });

    const clinePath = path.join(env.root, ".cline", "data", "settings", "cline_mcp_settings.json");
    expect(summary.results.find((result) => result.clientId === "cline")).toMatchObject({ status: "SYNCED", configPath: clinePath });
    expect(JSON.parse(fs.readFileSync(clinePath, "utf8")).mcpServers["vercel (mcpx)"].type).toBe("streamableHttp");
  });

  it("syncs VS Code Insiders to its own config", () => {
    const { env, config, host } = setup("mcpx-clients-insiders-");
    installClients(env.root, ["vscode-insiders"]);

    syncAllClients(config, new SecretsManager(), { host });

    const insidersPath = path.join(env.root, "Library", "Application Support", "Code - Insiders", "User", "mcp.json");
    expect(JSON.parse(fs.readFileSync(insidersPath, "utf8")).servers["vercel (mcpx)"].type).toBe("http");
    expect(fs.existsSync(path.join(env.root, "Library", "Application Support", "Code"))).toBe(false);
  });

  it("refuses to overwrite a config it cannot parse", () => {
    const { env, config, host } = setup("mcpx-clients-jsonc-");
    const vscodePath = path.join(env.root, "Library", "Application Support", "Code", "User", "mcp.json");
    fs.mkdirSync(path.dirname(vscodePath), { recursive: true });
    const original = "{\n  // comment\n  \"servers\": {}\n}\n";
    fs.writeFileSync(vscodePath, original);

    const summary = syncAllClients(config, new SecretsManager(), { host });

    expect(summary.results.find((result) => result.clientId === "vscode")?.status).toBe("ERROR");
    expect(fs.readFileSync(vscodePath, "utf8")).toBe(original);
  });

  it("points the Claude Desktop bridge at mcpx found on PATH without shelling out", () => {
    const { env, config, host } = setup("mcpx-clients-bridge-");
    installClients(env.root, ["claude-desktop"]);
    const binDir = path.join(env.root, "bin");
    fs.mkdirSync(binDir);
    fs.writeFileSync(path.join(binDir, "mcpx"), "");

    syncAllClients(config, new SecretsManager(), { host: { ...host, env: { ...host.env, PATH: binDir } } });

    const desktopPath = path.join(env.root, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    expect(JSON.parse(fs.readFileSync(desktopPath, "utf8")).mcpServers["vercel (mcpx)"]).toEqual({
      command: path.join(binDir, "mcpx"),
      args: ["proxy", "vercel"]
    });
  });
});
