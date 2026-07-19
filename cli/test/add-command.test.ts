import { describe, expect, it } from "bun:test";
import { parseCliAddCommand, tokenizeCommandLine } from "../src/core/add-command.js";

describe("add command parsing", () => {
  it("tokenizes quoted values and strips quote characters", () => {
    expect(tokenizeCommandLine("add supabase 'https://mcp.supabase.com/mcp' --header 'Authorization=Bearer token value'")).toEqual([
      "add",
      "supabase",
      "https://mcp.supabase.com/mcp",
      "--header",
      "Authorization=Bearer token value"
    ]);
  });

  it("parses quoted HTTP add commands as HTTP servers", () => {
    const result = parseCliAddCommand("mcpx add supabase 'https://mcp.supabase.com/mcp'");

    expect(result).toEqual({
      name: "supabase",
      spec: {
        transport: "http",
        url: "https://mcp.supabase.com/mcp"
      }
    });
  });

  it("keeps stdio command args split for client-native add commands", () => {
    const result = parseCliAddCommand("codex mcp add railway -- npx @railway/mcp-server");

    expect(result).toEqual({
      name: "railway",
      spec: {
        transport: "stdio",
        command: "npx",
        args: ["@railway/mcp-server"]
      }
    });
  });

  it("parses claude mcp add commands", () => {
    const result = parseCliAddCommand("claude mcp add supabase https://mcp.supabase.com/mcp");

    expect(result).toEqual({
      name: "supabase",
      spec: {
        transport: "http",
        url: "https://mcp.supabase.com/mcp"
      }
    });
  });

  it("parses qwen mcp add commands", () => {
    const result = parseCliAddCommand("qwen mcp add supabase https://mcp.supabase.com/mcp");

    expect(result).toEqual({
      name: "supabase",
      spec: {
        transport: "http",
        url: "https://mcp.supabase.com/mcp"
      }
    });
  });

  it("parses code --add-mcp JSON payloads", () => {
    const result = parseCliAddCommand('code --add-mcp \'{"name":"supabase","url":"https://mcp.supabase.com/mcp"}\'');

    expect(result).toEqual({
      name: "supabase",
      spec: {
        transport: "http",
        url: "https://mcp.supabase.com/mcp"
      }
    });
  });

  it("parses openclaw mcp add commands", () => {
    const result = parseCliAddCommand("openclaw mcp add supabase https://mcp.supabase.com/mcp");

    expect(result).toEqual({
      name: "supabase",
      spec: {
        transport: "http",
        url: "https://mcp.supabase.com/mcp"
      }
    });
  });

  it("parses hermes mcp add commands", () => {
    const result = parseCliAddCommand("hermes mcp add supabase https://mcp.supabase.com/mcp");

    expect(result).toEqual({
      name: "supabase",
      spec: {
        transport: "http",
        url: "https://mcp.supabase.com/mcp"
      }
    });
  });

  it("rejects unrecognized prose instead of silently misparsing it as a server", () => {
    expect(() => parseCliAddCommand("definitely not valid")).toThrow("Unrecognized command");
  });

  it("rejects bare '<name> <url>' input with no recognized command verb", () => {
    // No supported caller relies on this shape (the desktop app's CLI-input boxes always
    // prompt for a full "mcpx add ..." / "claude mcp add ..." style command, and no prior
    // test asserted the bare fallback), so it is rejected rather than silently accepted.
    expect(() => parseCliAddCommand("supabase https://mcp.supabase.com/mcp")).toThrow("Unrecognized command");
  });

  it("rejects bare input even after stripping the optional 'mcpx ' prefix", () => {
    expect(() => parseCliAddCommand("mcpx supabase https://mcp.supabase.com/mcp")).toThrow("Unrecognized command");
  });
});
