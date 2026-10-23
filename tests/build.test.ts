import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("entry point", () => {
  it("reserves stdout for MCP traffic", async () => {
    const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(source).toContain("startStdioServer()");
    expect(source).not.toMatch(/console\.(log|info|debug)\s*\(/);
  });

  it("emits exactly one Node.js executable shebang", async () => {
    const bundled = await readFile(new URL("../dist/index.js", import.meta.url), "utf8");
    expect(bundled.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(bundled.match(/^#!/gm)).toHaveLength(1);
  });
});
