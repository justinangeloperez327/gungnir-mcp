import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { foundationStatus, SERVER_NAME, SERVER_VERSION } from "./status.js";

/**
 * Group 1 deliberately exposes only a read-only status tool.
 * Native CLI integration and project mutations belong to later audited groups.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION
  });

  server.registerTool(
    "gungnir_status",
    {
      description: "Report the Gungnir MCP server's implemented capabilities without reading or modifying a project.",
      inputSchema: z.object({})
    },
    async () => ({
      content: [{
        type: "text",
        text: JSON.stringify(foundationStatus())
      }]
    })
  );

  return server;
}
