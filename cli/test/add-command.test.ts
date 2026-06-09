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
});
