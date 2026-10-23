import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { foundationStatus, SERVER_NAME, SERVER_VERSION } from "./status.js";

/**
 * One independent instance per MCP connection.
 * Group 2 supports stdio lifecycle and both protocol eras; native CLI
 * operations and project mutations remain deferred.
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
