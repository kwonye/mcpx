import { describe, expect, it } from "vitest";
import { buildEntries, buildSpec, rowsFromBindings, rowsFromRecord, validateServerName } from "../../src/renderer/lib/serverSpec";
import { deriveClientState, deriveServerState } from "../../src/renderer/lib/domain";
import { formatTokens, relativeTime, tildify } from "../../src/renderer/lib/format";
import { parseNavigation } from "../../src/renderer/shell/navigation";
import { isClientAddCommand, looksLikeUrl, suggestNameFromCommand, suggestNameFromUrl } from "../../src/shared/server-input";

describe("server editing model", () => {
  it("keeps an existing secret when its value is left blank", () => {
    const rows = rowsFromBindings([{ kind: "env", key: "API_KEY", value: "secret://auth_db_env_api_key" }], "env");
    expect(rows[0]).toMatchObject({ secret: true, value: "", originalRef: "secret://auth_db_env_api_key" });
    const built = buildEntries("db", "env", rows);
    expect(built.record).toEqual({ API_KEY: "secret://auth_db_env_api_key" });
    expect(built.secrets).toEqual({});
  });

  it("stores a new secret value under a generated secret name", () => {
    const rows = rowsFromBindings([{ kind: "env", key: "API_KEY", value: "secret://old" }], "env");
    rows[0].value = "new-token";
    const built = buildEntries("My DB", "env", rows);
    expect(built.record).toEqual({ API_KEY: "secret://auth_my_db_env_api_key" });
    expect(built.secrets).toEqual({ auth_my_db_env_api_key: "new-token" });
  });

  it("lets a row be stored as plain text", () => {
    const rows = rowsFromRecord({ REGION: "eu-west-1" });
    expect(rows[0].secret).toBe(false);
    expect(buildEntries("x", "env", rows).record).toEqual({ REGION: "eu-west-1" });
  });

  it("defaults secret-looking pasted values to secret", () => {
    expect(rowsFromRecord({ GITHUB_TOKEN: "abc" })[0].secret).toBe(true);
  });

  it("passes browser sign-in references through untouched", () => {
    const rows = rowsFromBindings([{ kind: "header", key: "Authorization", value: "oauth://github" }], "header");
    expect(rows[0].managedByOAuth).toBe(true);
    expect(buildEntries("github", "header", rows).record).toEqual({ Authorization: "oauth://github" });
  });

  it("reports row problems inline", () => {
    const rows = [...rowsFromRecord({ A: "1" }), { id: "dup", key: "a", value: "2", secret: false }, { id: "nokey", key: "", value: "3", secret: false }];
    const built = buildEntries("x", "env", rows);
    expect(built.errors.dup).toMatch(/twice/);
    expect(built.errors.nokey).toMatch(/name/);
  });

  it("validates the URL and command", () => {
    expect(buildSpec("x", { transport: "http", url: "notaurl", command: "", args: [], cwd: "", rows: [] }).errors.url).toBeTruthy();
    expect(buildSpec("x", { transport: "stdio", url: "", command: " ", args: [], cwd: "", rows: [] }).errors.command).toBeTruthy();
    expect(buildSpec("x", { transport: "stdio", url: "", command: "npx", args: ["-y", "", "pkg"], cwd: " /tmp ", rows: [], enabled: false }).spec)
      .toEqual({ transport: "stdio", command: "npx", args: ["-y", "pkg"], cwd: "/tmp", enabled: false });
  });

  it("validates server names", () => {
    expect(validateServerName("", [])).toMatch(/name/);
    expect(validateServerName("-bad", [])).toBeTruthy();
    expect(validateServerName("github", ["github"])).toMatch(/already exists/);
    expect(validateServerName("github", [])).toBeNull();
  });
});

describe("state vocabulary", () => {
  const base = { enabled: true, pendingSignIn: false, gatewayRunning: true, countsLoading: false };
  it("maps server state to one plain label", () => {
    expect(deriveServerState({ ...base, enabled: false }).label).toBe("Off");
    expect(deriveServerState({ ...base, pendingSignIn: true }).label).toBe("Needs sign-in");
    expect(deriveServerState({ ...base, tokenCount: { tools: 1, resources: 0, prompts: 0, total: 10 } }).label).toBe("Connected");
    expect(deriveServerState({ ...base, tokenCount: { tools: 0, resources: 0, prompts: 0, total: 0, error: "401 Unauthorized" } }).label).toBe("Needs sign-in");
    expect(deriveServerState({ ...base, tokenCount: { tools: 0, resources: 0, prompts: 0, total: 0, error: "boom", errorCode: "unreachable" } })).toMatchObject({ label: "Error", detail: "Unreachable: boom" });
    expect(deriveServerState({ ...base, gatewayRunning: false }).label).toBe("Gateway stopped");
    expect(deriveServerState({ ...base, countsLoading: true }).label).toBe("Checking");
  });

  it("maps client sync status, treating SKIPPED as not installed and unknown strings gracefully", () => {
    expect(deriveClientState({ status: "SYNCED" }).label).toBe("Synced");
    expect(deriveClientState({ status: "ERROR", message: "bad json" })).toMatchObject({ label: "Sync failed", detail: "bad json" });
    expect(deriveClientState({ status: "SKIPPED" }).label).toBe("Not installed");
    expect(deriveClientState({ status: "NEEDS_RESTART" }).label).toBe("Needs Restart");
    expect(deriveClientState(undefined).label).toBe("Not set up");
  });
});

describe("formatting", () => {
  it("formats token counts and times", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(420)).toBe("<1k");
    expect(formatTokens(3_400)).toBe("3.4k");
    expect(formatTokens(48_200)).toBe("48k");
    expect(relativeTime(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("5 min ago");
    expect(tildify("/Users/ana/src/web")).toBe("~/src/web");
  });
});

describe("navigation messages", () => {
  it("accepts the five routes and the desktop's own intents", () => {
    expect(parseNavigation("clients")).toEqual({ route: "clients", intent: null });
    expect(parseNavigation("servers:add")).toEqual({ route: "servers", intent: { type: "add-server" } });
    expect(parseNavigation("servers:auth:linear")).toEqual({ route: "servers", intent: { type: "sign-in", serverName: "linear" } });
    expect(parseNavigation("bogus")).toBeNull();
    expect(parseNavigation(42)).toBeNull();
  });
});

describe("add-server input", () => {
  it("classifies input and suggests names", () => {
    expect(isClientAddCommand("claude mcp add github https://x")).toBe(true);
    expect(isClientAddCommand("code --add-mcp '{}'")).toBe(true);
    expect(isClientAddCommand("npx -y foo")).toBe(false);
    expect(looksLikeUrl("https://mcp.linear.app/mcp")).toBe(true);
    expect(suggestNameFromUrl("https://mcp.linear.app/mcp")).toBe("linear");
    expect(suggestNameFromUrl("http://localhost:3000/mcp")).toBe("localhost");
    expect(suggestNameFromCommand(["npx", "-y", "@modelcontextprotocol/server-filesystem", "~/Documents"])).toBe("filesystem");
    expect(suggestNameFromCommand(["uvx", "mcp-server-postgres"])).toBe("postgres");
  });
});
