const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod/v4");

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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
