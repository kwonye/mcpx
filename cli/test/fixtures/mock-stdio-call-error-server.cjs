// Raw stdio JSON-RPC server for testing call-time upstream error surfacing.
// tools/list always succeeds; tools/call returns a JSON-RPC error (-32603)
// when the flag file (path from MOCK_CALL_FAIL_FLAG) contains "1", else
// returns a normal success result. The flag is re-read on every call so the
// behavior can be toggled within a single test.
const fs = require("node:fs");
const readline = require("node:readline");

const flagPath = process.env.MOCK_CALL_FAIL_FLAG;

const rl = readline.createInterface({ input: process.stdin, terminal: false });

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function shouldFail() {
  return Boolean(
    flagPath &&
      fs.existsSync(flagPath) &&
      fs.readFileSync(flagPath, "utf8").trim() === "1"
  );
}

rl.on("line", (line) => {
  if (!line.trim()) return;
  let payload;
  try {
    payload = JSON.parse(line);
  } catch {
    return;
  }

  // Notifications carry no id and expect no response.
  if (payload.id === undefined || payload.id === null) {
    return;
  }

  if (payload.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: payload.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "mock-call-error", version: "1.0.0" }
      }
    });
    return;
  }

  if (payload.method === "ping") {
    send({ jsonrpc: "2.0", id: payload.id, result: {} });
    return;
  }

  if (payload.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: payload.id,
      result: {
        tools: [
          {
            name: "whoami",
            description: "Return the current Railway user.",
            inputSchema: { type: "object", properties: {} }
          }
        ]
      }
    });
    return;
  }

  if (payload.method === "tools/call") {
    if (shouldFail()) {
      send({
        jsonrpc: "2.0",
        id: payload.id,
        error: {
          code: -32603,
          message: "Not authenticated. Run 'railway login' first. Unauthorized"
        }
      });
    } else {
      send({
        jsonrpc: "2.0",
        id: payload.id,
        result: { content: [{ type: "text", text: "ok" }] }
      });
    }
    return;
  }

  send({ jsonrpc: "2.0", id: payload.id, result: {} });
});
