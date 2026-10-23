import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("entry point", () => {
  it("reserves stdout for MCP traffic", async () => {
    const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(source).toContain("serveStdio(createServer)");
    expect(source).not.toMatch(/console\.(log|info|debug)\s*\(/);
  });
});
