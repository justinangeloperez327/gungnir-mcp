import { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import { createServer } from "../src/server.js";

describe("Gungnir MCP server factory", () => {
  it("returns an independent MCP server instance for each session", () => {
    const one = createServer();
    const two = createServer();

    expect(one).toBeInstanceOf(McpServer);
    expect(two).toBeInstanceOf(McpServer);
    expect(one).not.toBe(two);
  });
});
