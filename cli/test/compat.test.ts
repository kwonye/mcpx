/**
 * Tests for client-native compatibility layer.
 */

import { describe, it, expect } from "vitest";
import { parseCompatibilityArgs } from "../src/compat/index.js";
import { parseClaudeArgs } from "../src/compat/claude.js";
import { parseCodexArgs } from "../src/compat/codex.js";
import { parseVSCodeArgs } from "../src/compat/vscode.js";
import { detectUnsupportedClient } from "../src/compat/unsupported.js";

describe("parseCompatibilityArgs", () => {
  it("returns null for canonical mcpx add", () => {
    const result = parseCompatibilityArgs(["add", "my-server", "https://example.com/mcp"]);
    expect(result.client).toBe(null);
    expect(result.normalizedArgs).toBe(null);
    expect(result.error).toBeUndefined();
  });

  it("detects claude mcp add", () => {
    const result = parseCompatibilityArgs(["claude", "mcp", "add", "my-server", "https://example.com/mcp"]);
    expect(result.client).toBe("claude");
    expect(result.normalizedArgs).toEqual(["my-server", "https://example.com/mcp"]);
  });

  it("detects codex mcp add", () => {
    const result = parseCompatibilityArgs(["codex", "mcp", "add", "my-server", "--", "npx", "-y", "my-mcp"]);
    expect(result.client).toBe("codex");
    expect(result.normalizedArgs).toEqual(["my-server", "npx", "-y", "my-mcp"]);
  });

  it("detects vscode --add-mcp", () => {
    const json = JSON.stringify({ name: "my-server", url: "https://example.com/mcp" });
    const result = parseCompatibilityArgs(["code", "--add-mcp", json]);
    expect(result.client).toBe("vscode");
    expect(result.normalizedArgs).toEqual(["my-server", "https://example.com/mcp"]);
  });

  it("rejects unsupported cursor-agent", () => {
    const result = parseCompatibilityArgs(["cursor-agent", "mcp", "add", "my-server"]);
    expect(result.client).toBe("cursor-agent");
    expect(result.normalizedArgs).toBe(null);
    expect(result.error).toContain("Cursor");
    expect(result.error).toContain("mcpx add");
  });
});

describe("parseClaudeArgs", () => {
  describe("HTTP mode", () => {
    it("parses basic HTTP add", () => {
      const result = parseClaudeArgs(["my-server", "https://example.com/mcp"]);
      expect(result.error).toBeUndefined();
      expect(result.normalizedArgs).toEqual(["my-server", "https://example.com/mcp"]);
    });

    it("parses HTTP add with headers", () => {
      const result = parseClaudeArgs([
        "my-server",
        "https://example.com/mcp",
        "--header",
        "Authorization: Bearer token123"
      ]);
      expect(result.error).toBeUndefined();
      expect(result.normalizedArgs).toEqual([
        "my-server",
        "https://example.com/mcp",
        "--header",
        "Authorization=Bearer token123"
      ]);
    });

    it("parses HTTP add with multiple headers", () => {
      const result = parseClaudeArgs([
        "my-server",
        "https://example.com/mcp",
        "--header",
        "Authorization: Bearer token123",
        "--header",
        "X-Custom-Header: value"
      ]);
      expect(result.error).toBeUndefined();
      expect(result.normalizedArgs).toEqual([
        "my-server",
        "https://example.com/mcp",
        "--header",
        "Authorization=Bearer token123",
        "--header",
        "X-Custom-Header=value"
      ]);
    });

    it("handles permissive option ordering (flags before name)", () => {
      const result = parseClaudeArgs([
        "--header",
        "Authorization: Bearer token123",
        "my-server",
        "https://example.com/mcp"
      ]);
      expect(result.error).toBeUndefined();
      expect(result.normalizedArgs).toEqual([
        "my-server",
        "https://example.com/mcp",
        "--header",
        "Authorization=Bearer token123"
      ]);
    });

    it("handles permissive option ordering (flags between name and url)", () => {
      const result = parseClaudeArgs([
        "my-server",
        "--header",
        "Authorization: Bearer token123",
        "https://example.com/mcp"
      ]);
      expect(result.error).toBeUndefined();
      expect(result.normalizedArgs).toEqual([
        "my-server",
        "https://example.com/mcp",
        "--header",
        "Authorization=Bearer token123"
      ]);
    });
  });

  describe("stdio mode", () => {
    it("parses basic stdio add", () => {
      const result = parseClaudeArgs(["my-server", "--", "npx", "-y", "my-mcp"]);
      expect(result.error).toBeUndefined();
      expect(result.normalizedArgs).toEqual(["my-server", "npx", "-y", "my-mcp"]);
    });

    it("parses stdio add with env vars", () => {
      const result = parseClaudeArgs([
        "my-server",
        "--env",
        "API_KEY=secret123",
        "--",
        "npx",
        "-y",
        "my-mcp"
      ]);
      expect(result.error).toBeUndefined();
      expect(result.normalizedArgs).toEqual([
        "my-server",
        "npx",
        "-y",
        "my-mcp",
        "--env",
        "API_KEY=secret123"
      ]);
    });

    it("parses stdio add with multiple env vars", () => {
      const result = parseClaudeArgs([
        "my-server",
        "--env",
        "API_KEY=secret123",
        "--env",
        "DEBUG=true",
        "--",
        "npx",
        "-y",
        "my-mcp"
      ]);
      expect(result.error).toBeUndefined();
      expect(result.normalizedArgs).toEqual([
        "my-server",
        "npx",
        "-y",
        "my-mcp",
        "--env",
        "API_KEY=secret123",
        "--env",
        "DEBUG=true"
      ]);
    });

    it("handles permissive option ordering (flags before name)", () => {
      const result = parseClaudeArgs([
        "--env",
        "API_KEY=secret123",
        "my-server",
        "--",
        "npx",
        "-y",
        "my-mcp"
      ]);
      expect(result.error).toBeUndefined();
      expect(result.normalizedArgs).toEqual([
        "my-server",
        "npx",
        "-y",
        "my-mcp",
        "--env",
        "API_KEY=secret123"
      ]);
    });

    it("handles permissive option ordering (flags between name and separator)", () => {
      const result = parseClaudeArgs([
        "my-server",
        "--env",
        "API_KEY=secret123",
        "--",
        "npx",
        "-y",
        "my-mcp"
      ]);
      expect(result.error).toBeUndefined();
      expect(result.normalizedArgs).toEqual([
        "my-server",
        "npx",
        "-y",
        "my-mcp",
        "--env",
        "API_KEY=secret123"
      ]);
    });

    it("parses stdio add with command args", () => {
      const result = parseClaudeArgs(["my-server", "--", "node", "server.js", "--port", "3000"]);
      expect(result.error).toBeUndefined();
      expect(result.normalizedArgs).toEqual(["my-server", "node", "server.js", "--port", "3000"]);
    });
  });

  describe("unsupported features", () => {
    it("rejects --transport sse", () => {
      const result = parseClaudeArgs(["my-server", "--transport", "sse", "https://example.com/mcp"]);
      expect(result.error).toContain("--transport sse");
      expect(result.error).toContain("not supported");
    });

    it("rejects --scope", () => {
      const result = parseClaudeArgs(["my-server", "--scope", "project", "--", "npx", "-y", "my-mcp"]);
      expect(result.error).toContain("--scope");
      expect(result.error).toContain("not supported");
    });

    it("rejects JSON input", () => {
      const result = parseClaudeArgs(["{ \"name\": \"test\" }"]);
      expect(result.error).toContain("JSON import");
      expect(result.error).toContain("not supported");
    });

    it("rejects --json flag", () => {
      const result = parseClaudeArgs(["--json", "my-server", "--", "npx", "-y", "my-mcp"]);
      expect(result.error).toContain("JSON import");
      expect(result.error).toContain("not supported");
    });

    it("rejects desktop import", () => {
      const result = parseClaudeArgs(["--from-desktop", "my-server"]);
      expect(result.error).toContain("desktop config import");
      expect(result.error).toContain("not supported");
    });
  });

  describe("error cases", () => {
    it("returns error for empty args", () => {
      const result = parseClaudeArgs([]);
      expect(result.error).toContain("Usage");
    });

    it("returns error for HTTP mode without url", () => {
      const result = parseClaudeArgs(["my-server"]);
      expect(result.error).toContain("HTTP mode requires");
    });

    it("returns error for stdio mode without command", () => {
      const result = parseClaudeArgs(["my-server", "--"]);
      expect(result.error).toContain("stdio mode requires");
      expect(result.error).toContain("command");
    });
  });
});

describe("parseCodexArgs", () => {
  describe("stdio mode", () => {
    it("parses basic stdio add", () => {
      const result = parseCodexArgs(["my-server", "--", "npx", "-y", "my-mcp"]);
      expect(result.error).toBeUndefined();
      expect(result.normalizedArgs).toEqual(["my-server", "npx", "-y", "my-mcp"]);
    });

    it("parses stdio add with env vars", () => {
      const result = parseCodexArgs([
        "my-server",
        "--env",
        "API_KEY=secret123",
        "--",
        "npx",
        "-y",
        "my-mcp"
      ]);
      expect(result.error).toBeUndefined();
      expect(result.normalizedArgs).toEqual([
        "my-server",
        "npx",
        "-y",
        "my-mcp",
        "--env",
        "API_KEY=secret123"
      ]);
    });

    it("parses stdio add with multiple env vars", () => {
      const result = parseCodexArgs([
        "my-server",
        "-e",
        "API_KEY=secret123",
        "-e",
        "DEBUG=true",
        "--",
        "npx",
        "-y",
        "my-mcp"
      ]);
      expect(result.error).toBeUndefined();
      expect(result.normalizedArgs).toEqual([
        "my-server",
        "npx",
        "-y",
        "my-mcp",
        "--env",
        "API_KEY=secret123",
        "--env",
        "DEBUG=true"
      ]);
    });

    it("handles permissive option ordering (flags before name)", () => {
      const result = parseCodexArgs([
        "--env",
        "API_KEY=secret123",
        "my-server",
        "--",
        "npx",
        "-y",
        "my-mcp"
      ]);
      expect(result.error).toBeUndefined();
      expect(result.normalizedArgs).toEqual([
        "my-server",
        "npx",
        "-y",
        "my-mcp",
        "--env",
        "API_KEY=secret123"
      ]);
    });

    it("parses stdio add with command args", () => {
      const result = parseCodexArgs(["my-server", "--", "node", "server.js", "--port", "3000"]);
      expect(result.error).toBeUndefined();
      expect(result.normalizedArgs).toEqual(["my-server", "node", "server.js", "--port", "3000"]);
    });
  });

  describe("unsupported features", () => {
    it("rejects --url flag (HTTP semantics)", () => {
      const result = parseCodexArgs(["my-server", "--url", "https://example.com/mcp", "--", "npx", "-y", "my-mcp"]);
      expect(result.error).toContain("HTTP semantics");
      expect(result.error).toContain("not supported");
    });

    it("rejects --http flag", () => {
      const result = parseCodexArgs(["my-server", "--http", "--", "npx", "-y", "my-mcp"]);
      expect(result.error).toContain("HTTP semantics");
      expect(result.error).toContain("not supported");
    });

    it("rejects missing separator", () => {
      const result = parseCodexArgs(["my-server", "--env", "KEY=value"]);
      expect(result.error).toContain("--");
      expect(result.error).toContain("separator");
    });
  });

  describe("error cases", () => {
    it("returns error for empty args", () => {
      const result = parseCodexArgs([]);
      expect(result.error).toContain("Usage");
    });

    it("returns error for stdio mode without command", () => {
      const result = parseCodexArgs(["my-server", "--"]);
      expect(result.error).toContain("stdio mode requires");
      expect(result.error).toContain("command");
    });
  });
});

describe("parseVSCodeArgs", () => {
  describe("HTTP mode", () => {
    it("parses basic HTTP config", () => {
      const json = JSON.stringify({ name: "my-server", url: "https://example.com/mcp" });
      const result = parseVSCodeArgs(json);
      expect(result.error).toBeUndefined();
      expect(result.normalizedArgs).toEqual(["my-server", "https://example.com/mcp"]);
    });

    it("parses HTTP config with headers", () => {
      const json = JSON.stringify({
        name: "my-server",
        url: "https://example.com/mcp",
        headers: {
          Authorization: "Bearer token123",
          "X-Custom-Header": "value"
        }
      });
      const result = parseVSCodeArgs(json);
      expect(result.error).toBeUndefined();
      expect(result.normalizedArgs).toEqual([
        "my-server",
        "https://example.com/mcp",
        "--header",
        "Authorization=Bearer token123",
        "--header",
        "X-Custom-Header=value"
      ]);
    });

    it("parses HTTP config with explicit type", () => {
      const json = JSON.stringify({ name: "my-server", type: "http", url: "https://example.com/mcp" });
      const result = parseVSCodeArgs(json);
      expect(result.error).toBeUndefined();
      expect(result.normalizedArgs).toEqual(["my-server", "https://example.com/mcp"]);
    });
  });

  describe("stdio mode", () => {
    it("parses basic stdio config", () => {
      const json = JSON.stringify({ name: "my-server", command: "npx", args: ["-y", "my-mcp"] });
      const result = parseVSCodeArgs(json);
      expect(result.error).toBeUndefined();
      expect(result.normalizedArgs).toEqual(["my-server", "npx", "-y", "my-mcp"]);
    });

    it("parses stdio config with env", () => {
      const json = JSON.stringify({
        name: "my-server",
        command: "npx",
        args: ["-y", "my-mcp"],
        env: {
          API_KEY: "secret123",
          DEBUG: "true"
        }
      });
      const result = parseVSCodeArgs(json);
      expect(result.error).toBeUndefined();
      expect(result.normalizedArgs).toEqual([
        "my-server",
        "npx",
        "-y",
        "my-mcp",
        "--env",
        "API_KEY=secret123",
        "--env",
        "DEBUG=true"
      ]);
    });

    it("parses stdio config without args", () => {
      const json = JSON.stringify({ name: "my-server", command: "npx" });
      const result = parseVSCodeArgs(json);
      expect(result.error).toBeUndefined();
      expect(result.normalizedArgs).toEqual(["my-server", "npx"]);
    });

    it("parses stdio config with explicit type", () => {
      const json = JSON.stringify({ name: "my-server", type: "stdio", command: "npx" });
      const result = parseVSCodeArgs(json);
      expect(result.error).toBeUndefined();
      expect(result.normalizedArgs).toEqual(["my-server", "npx"]);
    });
  });

  describe("unsupported features", () => {
    it("rejects sandbox field", () => {
      const json = JSON.stringify({
        name: "my-server",
        url: "https://example.com/mcp",
        sandbox: true
      });
      const result = parseVSCodeArgs(json);
      expect(result.error).toContain("sandbox");
      expect(result.error).toContain("not supported");
    });

    it("rejects scope field", () => {
      const json = JSON.stringify({
        name: "my-server",
        url: "https://example.com/mcp",
        scope: "workspace"
      });
      const result = parseVSCodeArgs(json);
      expect(result.error).toContain("scope");
      expect(result.error).toContain("not supported");
    });

    it("rejects container field", () => {
      const json = JSON.stringify({
        name: "my-server",
        url: "https://example.com/mcp",
        container: "docker"
      });
      const result = parseVSCodeArgs(json);
      expect(result.error).toContain("container");
      expect(result.error).toContain("not supported");
    });

    it("rejects array of servers", () => {
      const json = JSON.stringify([
        { name: "server1", url: "https://example1.com/mcp" },
        { name: "server2", url: "https://example2.com/mcp" }
      ]);
      const result = parseVSCodeArgs(json);
      expect(result.error).toContain("Array of servers");
      expect(result.error).toContain("individually");
    });
  });

  describe("validation errors", () => {
    it("rejects invalid JSON", () => {
      const result = parseVSCodeArgs("{ invalid json }");
      expect(result.error).toContain("Invalid JSON");
    });

    it("rejects missing name", () => {
      const json = JSON.stringify({ url: "https://example.com/mcp" });
      const result = parseVSCodeArgs(json);
      expect(result.error).toContain("name");
    });

    it("rejects missing url and command", () => {
      const json = JSON.stringify({ name: "my-server" });
      const result = parseVSCodeArgs(json);
      expect(result.error).toContain("url");
      expect(result.error).toContain("command");
    });

    it("rejects both url and command", () => {
      const json = JSON.stringify({
        name: "my-server",
        url: "https://example.com/mcp",
        command: "npx"
      });
      const result = parseVSCodeArgs(json);
      expect(result.error).toContain("both");
    });

    it("rejects invalid type", () => {
      const json = JSON.stringify({ name: "my-server", type: "invalid", url: "https://example.com/mcp" });
      const result = parseVSCodeArgs(json);
      expect(result.error).toContain("type");
    });

    it("rejects non-object env", () => {
      const json = JSON.stringify({ name: "my-server", command: "npx", env: "invalid" });
      const result = parseVSCodeArgs(json);
      expect(result.error).toContain("env");
    });

    it("rejects non-string env values", () => {
      const json = JSON.stringify({ name: "my-server", command: "npx", env: { KEY: 123 } });
      const result = parseVSCodeArgs(json);
      expect(result.error).toContain("env");
    });

    it("rejects non-object headers", () => {
      const json = JSON.stringify({ name: "my-server", url: "https://example.com/mcp", headers: "invalid" });
      const result = parseVSCodeArgs(json);
      expect(result.error).toContain("headers");
    });

    it("rejects non-string header values", () => {
      const json = JSON.stringify({ name: "my-server", url: "https://example.com/mcp", headers: { Key: 123 } });
      const result = parseVSCodeArgs(json);
      expect(result.error).toContain("headers");
    });

    it("rejects non-array args", () => {
      const json = JSON.stringify({ name: "my-server", command: "npx", args: "invalid" });
      const result = parseVSCodeArgs(json);
      expect(result.error).toContain("args");
    });

    it("rejects non-string args elements", () => {
      const json = JSON.stringify({ name: "my-server", command: "npx", args: [123] });
      const result = parseVSCodeArgs(json);
      expect(result.error).toContain("args");
    });
  });

  describe("error cases", () => {
    it("returns error for undefined payload", () => {
      const result = parseVSCodeArgs(undefined);
      expect(result.error).toContain("Usage");
    });

    it("returns error for empty payload", () => {
      const result = parseVSCodeArgs("");
      expect(result.error).toContain("Usage");
    });
  });
});

describe("detectUnsupportedClient", () => {
  it("detects cursor-agent", () => {
    const result = detectUnsupportedClient(["cursor-agent", "mcp", "add", "my-server"]);
    expect(result).not.toBeNull();
    expect(result?.client).toBe("cursor-agent");
    expect(result?.error).toContain("Cursor");
    expect(result?.error).toContain("mcpx add");
  });

  it("detects cline", () => {
    const result = detectUnsupportedClient(["cline", "mcp", "add", "my-server"]);
    expect(result).not.toBeNull();
    expect(result?.client).toBe("cline");
    expect(result?.error).toContain("Cline");
    expect(result?.error).toContain("mcpx add");
  });

  it("detects kiro", () => {
    const result = detectUnsupportedClient(["kiro", "mcp", "add", "my-server"]);
    expect(result).not.toBeNull();
    expect(result?.client).toBe("kiro");
    expect(result?.error).toContain("Kiro");
    expect(result?.error).toContain("mcpx add");
  });

  it("detects opencode", () => {
    const result = detectUnsupportedClient(["opencode", "mcp", "add", "my-server"]);
    expect(result).not.toBeNull();
    expect(result?.client).toBe("opencode");
    expect(result?.error).toContain("OpenCode");
    expect(result?.error).toContain("mcpx add");
  });

  it("returns null for supported clients", () => {
    expect(detectUnsupportedClient(["claude", "mcp", "add", "my-server"])).toBeNull();
    expect(detectUnsupportedClient(["codex", "mcp", "add", "my-server"])).toBeNull();
    expect(detectUnsupportedClient(["code", "--add-mcp", "{}"])).toBeNull();
    expect(detectUnsupportedClient(["add", "my-server", "https://example.com/mcp"])).toBeNull();
  });

  it("returns null for empty args", () => {
    expect(detectUnsupportedClient([])).toBeNull();
  });
});
