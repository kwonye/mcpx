// Strict MCP v2 stdio server for testing call-time upstream error surfacing.
// tools/list always succeeds; tools/call throws a protocol error while the
// flag file contains "1", and succeeds after the flag is cleared.
const fs = require("node:fs");
const { Server, ProtocolError } = require("@modelcontextprotocol/server");
const { serveStdio } = require("@modelcontextprotocol/server/stdio");

const flagPath = process.env.MOCK_CALL_FAIL_FLAG;

function shouldFail() {
  return Boolean(
    flagPath &&
      fs.existsSync(flagPath) &&
      fs.readFileSync(flagPath, "utf8").trim() === "1"
  );
}

serveStdio(() => {
  const server = new Server(
    { name: "mock-call-error", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      supportedProtocolVersions: ["2026-07-28"]
    }
  );

  server.setRequestHandler("tools/list", async () => ({
    tools: [
      {
        name: "whoami",
        description: "Return the current Railway user.",
        inputSchema: { type: "object", properties: {} }
      }
    ]
  }));

  server.setRequestHandler("tools/call", async () => {
    if (shouldFail()) {
      throw new ProtocolError(-32603, "Not authenticated. Run 'railway login' first. Unauthorized");
    }
    return { content: [{ type: "text", text: "ok" }] };
  });

  return server;
}, { legacy: "reject" });
