import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { checkGungnir, verifyGungnirIr } from "./compiler-check.js";
import { disabledRuntimeConfig } from "./config.js";
import type { RuntimeConfig } from "./config.js";
import { listProjectModules, scanProject, summarizeProject } from "./project.js";
import { foundationStatus, SERVER_NAME, SERVER_VERSION } from "./status.js";
import { discoverToolchain } from "./toolchain.js";

/** One independently configured server per connection; only read-only tools. */
export function createServer(config: RuntimeConfig = disabledRuntimeConfig()): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "gungnir_status",
    {
      description: "Report capabilities and project trust without exposing filesystem paths.",
      inputSchema: z.strictObject({})
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify(foundationStatus(config)) }]
    })
  );

  server.registerTool(
    "gungnir_toolchain_info",
    {
      description: "Inspect Gungnir CLI, compiler, SDK profile/adapters and CMake via fixed read-only --version probes.",
      inputSchema: z.strictObject({})
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify(await discoverToolchain()) }]
    })
  );

  server.registerTool(
    "gungnir_project_info",
    {
      description: "Read trusted Gungnir project marker, profile, directory presence and bounded .gnr module counts. No file content or absolute paths.",
      inputSchema: z.strictObject({})
    },
    async () => {
      try {
        return { content: [{ type: "text", text: JSON.stringify(summarizeProject(await scanProject(config))) }] };
      } catch {
        return { isError: true, content: [{ type: "text", text: "Project inspection denied or unavailable" }] };
      }
    }
  );

  server.registerTool(
    "gungnir_list_modules",
    {
      description: "List up to 200 relative .gnr module paths inside the configured trusted project without following symlinks or reading source.",
      inputSchema: z.strictObject({})
    },
    async () => {
      try {
        return { content: [{ type: "text", text: JSON.stringify(listProjectModules(await scanProject(config))) }] };
      } catch {
        return { isError: true, content: [{ type: "text", text: "Project inspection denied or unavailable" }] };
      }
    }
  );


  server.registerTool(
    "gungnir_check",
    {
      description: "Validate a trusted structured Gungnir project or a single indexed .gnr source using native gungnirc --check. Never builds or generates files.",
      inputSchema: z.strictObject({
        file: z.string().max(256).optional()
      })
    },
    async ({ file }) => {
      const result = await checkGungnir(config, file);
      return {
        isError: result.state !== "valid",
        content: [{ type: "text" as const, text: JSON.stringify(result) }]
      };
    }
  );


  server.registerTool(
    "gungnir_verify_ir",
    {
      description: "Verify C++ IR for a trusted structured Gungnir project or indexed .gnr module, without emitting files or running a build.",
      inputSchema: z.strictObject({
        file: z.string().max(256).optional()
      })
    },
    async ({ file }) => {
      const result = await verifyGungnirIr(config, file);
      return {
        isError: result.state !== "valid",
        content: [{ type: "text" as const, text: JSON.stringify(result) }]
      };
    }
  );

  return server;
}
