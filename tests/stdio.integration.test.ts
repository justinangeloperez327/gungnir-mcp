import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, expect, it } from "vitest";

const entry = resolve(process.cwd(), "dist/index.js");

type ProtocolMode = "legacy" | "modern";

async function connectClient(mode: ProtocolMode, args: string[] = []): Promise<Client> {
  const client = new Client(
    { name: "gungnir-integration-test", version: "0.3.0" },
    { versionNegotiation: { mode: mode === "legacy" ? "legacy" : { pin: "2026-07-28" } } }
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry, ...args],
    cwd: process.cwd(),
    stderr: "pipe"
  });
  const diagnostics: string[] = [];
  transport.stderr?.on("data", (chunk: Buffer) => { diagnostics.push(chunk.toString("utf8")); });
  try {
    await client.connect(transport);
  } catch (error) {
    throw new Error(`MCP connection failed: ${String(error)}; child stderr: ${diagnostics.join("")}`);
  }
  return client;
}

async function assertStatus(client: Client): Promise<void> {
  const tools = await client.listTools();
  expect(tools.tools.map((tool) => tool.name)).toContain("gungnir_status");

  const result = await client.callTool({ name: "gungnir_status", arguments: {} });
  expect(result.isError).not.toBe(true);
  const content = result.content[0];
  expect(content?.type).toBe("text");
  if (content?.type !== "text") throw new Error("Expected text response");
  const status: unknown = JSON.parse(content.text);
  expect(status).toMatchObject({
    name: "gungnir-mcp",
    version: "0.3.0",
    implementationGroup: 3,
    nativeCliAvailable: "not-checked",
    projectMutationEnabled: false,
    projectAccess: "disabled"
  });
}

describe("real MCP stdio client interoperability", () => {
  it("negotiates the legacy initialize era and completes a tool call", async () => {
    const client = await connectClient("legacy");
    try {
      expect(client.getProtocolEra()).toBe("legacy");
      await assertStatus(client);
    } finally {
      await client.close();
    }
  });

  it("negotiates modern 2026 discovery and completes a tool call", async () => {
    const client = await connectClient("modern");
    try {
      expect(client.getProtocolEra()).toBe("modern");
      await assertStatus(client);
    } finally {
      await client.close();
    }
  });

  it("recovers from an unknown tool request on the same connection", async () => {
    const client = await connectClient("legacy");
    try {
      let rejected = false;
      try {
        const response = await client.callTool({ name: "gungnir_does_not_exist", arguments: {} });
        rejected = response.isError === true;
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
      await assertStatus(client);
    } finally {
      await client.close();
    }
  });

  it("uses explicit CLI roots and reports trust without leaking paths", async () => {
    const { mkdtemp, mkdir, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const temp = await mkdtemp(join(tmpdir(), "gungnir-mcp-client-"));
    const project = join(temp, "application");
    await mkdir(project);
    try {
      const client = await connectClient("modern", [
        "--project-root", project, "--trusted-root", temp
      ]);
      try {
        const response = await client.callTool({ name: "gungnir_status", arguments: {} });
        const item = response.content[0];
        expect(item?.type).toBe("text");
        if (item?.type !== "text") throw new Error("Expected status text");
        expect(item.text).toContain('"projectAccess":"trusted"');
        expect(item.text).not.toContain(temp);
      } finally {
        await client.close();
      }
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("exits cleanly when the client closes stdin (EOF)", async () => {
    const child = spawn(process.execPath, [entry], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });

    try {
      const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, rejectExit) => {
        child.once("error", rejectExit);
        child.once("exit", (code, signal) => resolveExit({ code, signal }));
      });
      child.stdin.end();
      const result = await exit;
      expect({ ...result, stderr }).toEqual({ code: 0, signal: null, stderr: "" });
      expect(stdout).toBe("");
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  });
});
