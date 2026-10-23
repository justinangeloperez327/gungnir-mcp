import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { disabledRuntimeConfig } from "./config.js";
import type { RuntimeConfig } from "./config.js";
import { foundationStatus, SERVER_NAME, SERVER_VERSION } from "./status.js";

/** One independently configured server per connection; no native CLI calls. */
export function createServer(config: RuntimeConfig = disabledRuntimeConfig()): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  server.registerTool(
    "gungnir_status",
    {
      description: "Report the server's available read-only capabilities and trust state without exposing project paths.",
      inputSchema: z.object({})
    },
    async () => ({
      content: [{
        type: "text",
        text: JSON.stringify(foundationStatus(config))
      }]
    })
  );
  return server;
}
