import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools";

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "prism-mcp",
    version: "0.1.0",
  });
  registerTools(server);
  return server;
}
