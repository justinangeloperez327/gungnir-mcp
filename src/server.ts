import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { disabledRuntimeConfig } from "./config.js";
import type { RuntimeConfig } from "./config.js";
import { foundationStatus, SERVER_NAME, SERVER_VERSION } from "./status.js";
import { discoverToolchain } from "./toolchain.js";

/** One independently configured server per connection; no project code executes. */
export function createServer(config: RuntimeConfig = disabledRuntimeConfig()): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "gungnir_status",
    {
      description: "Report available capabilities and project trust without exposing filesystem paths.",
      inputSchema: z.object({})
    },
    async () => ({
      content: [{
        type: "text",
        text: JSON.stringify(foundationStatus(config))
      }]
    })
  );

  server.registerTool(
    "gungnir_toolchain_info",
    {
      description: "Discover Gungnir CLI, compiler, SDK profile/adapters and CMake via read-only --version probes. Never builds or runs a project.",
      inputSchema: z.object({})
    },
    async () => ({
      content: [{
        type: "text",
        text: JSON.stringify(await discoverToolchain())
      }]
    })
  );

  return server;
}
