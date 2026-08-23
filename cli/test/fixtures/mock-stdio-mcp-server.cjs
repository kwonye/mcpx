const { McpServer } = require("@modelcontextprotocol/server");
const { serveStdio } = require("@modelcontextprotocol/server/stdio");
const z = require("zod/v4");

serveStdio(() => {
  const server = new McpServer({
    name: "mock-stdio-server",
    version: "1.0.0"
  });

  server.registerTool(
    "echo",
    {
      description: "Echo input text.",
      inputSchema: {
        text: z.string().optional()
      }
    },
    async ({ text }) => ({
      content: [
        {
          type: "text",
          text: text ?? "ok"
        }
      ]
    })
  );

  return server;
}, { legacy: "reject" });
