#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server";

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // IMPORTANT: stderr only. stdout is reserved for JSON-RPC over stdio.
  console.error("prism-mcp failed to start:", err);
  process.exit(1);
});
