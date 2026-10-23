import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, expect, it } from "vitest";

const entry = resolve(process.cwd(), "dist/index.js");

type ProtocolMode = "legacy" | "modern";

async function connectClient(mode: ProtocolMode, args: string[] = []): Promise<Client> {
  const client = new Client(
    { name: "gungnir-integration-test", version: "0.8.0" },
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
  expect(tools.tools.map((tool) => tool.name)).toContain("gungnir_toolchain_info");
  expect(tools.tools.map((tool) => tool.name)).toContain("gungnir_project_info");
  expect(tools.tools.map((tool) => tool.name)).toContain("gungnir_list_modules");
  expect(tools.tools.map((tool) => tool.name)).toContain("gungnir_check");
  expect(tools.tools.map((tool) => tool.name)).toContain("gungnir_verify_ir");

  const result = await client.callTool({ name: "gungnir_status", arguments: {} });
  expect(result.isError).not.toBe(true);
  const content = result.content[0];
  expect(content?.type).toBe("text");
  if (content?.type !== "text") throw new Error("Expected text response");
  const status: unknown = JSON.parse(content.text);
  expect(status).toMatchObject({
    name: "gungnir-mcp",
    version: "0.8.0",
    implementationGroup: 8,
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

  it("returns structured toolchain results with no arbitrary tool arguments or paths", async () => {
    const client = await connectClient("modern");
    try {
      const response = await client.callTool({ name: "gungnir_toolchain_info", arguments: {} });
      expect(response.isError).not.toBe(true);
      const result = response.content[0];
      if (result?.type !== "text") throw new Error("Expected toolchain report");
      const data = JSON.parse(result.text) as Record<string, unknown>;
      expect(data).toHaveProperty("sdk");
      expect(data).toHaveProperty("cmake");
      expect(data).toHaveProperty("diagnostics");
      expect(data).not.toHaveProperty("absolutePath");
      expect(data).not.toHaveProperty("projectRoot");
    } finally {
      await client.close();
    }
  });

  it("denies project tools without explicit trust in both protocol eras", async () => {
    for (const mode of ["legacy", "modern"] as const) {
      const client = await connectClient(mode);
      try {
        for (const name of ["gungnir_project_info", "gungnir_list_modules"]) {
          const response = await client.callTool({ name, arguments: {} });
          expect(response.isError).toBe(true);
          expect(JSON.stringify(response)).not.toContain(process.cwd());
        }
      } finally {
        await client.close();
      }
    }
  });

  it("returns only relative modules in trusted projects in both protocol eras", async () => {
    const { mkdtemp, mkdir, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const temp = await mkdtemp(join(tmpdir(), "gungnir-mcp-scanner-"));
    const project = join(temp, "app-project");
    await mkdir(join(project, "app", "models"), { recursive: true });
    await mkdir(join(project, "routes"), { recursive: true });
    await writeFile(join(project, ".gungnir-project"), "name=app_project\\nprofile=structured\\n".replaceAll("\\n", "\n"));
    await writeFile(join(project, "app", "models", "User.gnr"), "PRIVATE_SOURCE");
    await writeFile(join(project, "routes", "web.gnr"), "Route::get");
    try {
      for (const mode of ["legacy", "modern"] as const) {
        const client = await connectClient(mode, ["--project-root", project, "--trusted-root", temp]);
        try {
          const projectInfo = await client.callTool({ name: "gungnir_project_info", arguments: {} });
          expect(projectInfo.isError).not.toBe(true);
          const first = projectInfo.content[0];
          if (first?.type !== "text") throw new Error("Expected project info");
          const info = JSON.parse(first.text) as Record<string, unknown>;
          expect(info).toMatchObject({
            profile: "structured", marker: "present", moduleCount: 2
          });
          expect(JSON.stringify(info)).not.toContain(temp);
          const listing = await client.callTool({ name: "gungnir_list_modules", arguments: {} });
          expect(listing.isError).not.toBe(true);
          const second = listing.content[0];
          if (second?.type !== "text") throw new Error("Expected module listing");
          const modules = JSON.parse(second.text) as { modules: Array<{ path: string }> };
          expect(modules.modules.map(m => m.path)).toEqual(["app/models/User.gnr", "routes/web.gnr"]);
          expect(second.text).not.toContain("PRIVATE_SOURCE");
          expect(second.text).not.toContain(temp);
        } finally {
          await client.close();
        }
      }
    } finally {
      await rm(temp, { force: true, recursive: true });
    }
  });

  it("rejects compiler validation without project trust in both protocol modes", async () => {
    for (const mode of ["legacy", "modern"] as const) {
      const client = await connectClient(mode);
      try {
        for (const arguments_ of [{}, { file: "app/models/User.gnr" }]) {
          const response = await client.callTool({ name: "gungnir_check", arguments: arguments_ });
          expect(response.isError).toBe(true);
          const content = response.content[0];
          if (content?.type !== "text") throw new Error("Expected check response");
          const report = JSON.parse(content.text) as Record<string, unknown>;
          expect(report).toMatchObject({ state: "blocked", reason: "trusted_project_required" });
        }
      } finally { await client.close(); }
    }
  });

  it("rejects compiler path traversal through the real MCP stdio transport", async () => {
    const { mkdtemp, mkdir, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const tmp = await mkdtemp(join(tmpdir(), "gungnir-compiler-client-"));
    const project = join(tmp, "app");
    await mkdir(join(project, "app", "models"), { recursive: true });
    await mkdir(join(project, "routes"), { recursive: true });
    await writeFile(join(project, ".gungnir-project"), "name=sample\nprofile=structured\n");
    await writeFile(join(project, "app", "models", "User.gnr"), "model User {}");
    try {
      for (const mode of ["legacy", "modern"] as const) {
        const client = await connectClient(mode, ["--project-root", project, "--trusted-root", tmp]);
        try {
          const response = await client.callTool({
            name: "gungnir_check", arguments: { file: "../outside.gnr" }
          });
          expect(response.isError).toBe(true);
          const content = response.content[0];
          if (content?.type !== "text") throw new Error("Expected check report");
          const report = JSON.parse(content.text) as Record<string, unknown>;
          expect(report.state).toBe("blocked");
          expect(content.text).not.toContain(tmp);
        } finally { await client.close(); }
      }
    } finally { await rm(tmp, { recursive: true, force: true }); }
  });

  it("rejects IR verification without trust in legacy and modern sessions", async () => {
    for (const mode of ["legacy", "modern"] as const) {
      const client = await connectClient(mode);
      try {
        for (const args of [{}, { file: "app/models/User.gnr" }]) {
          const result = await client.callTool({ name: "gungnir_verify_ir", arguments: args });
          expect(result.isError).toBe(true);
          const content = result.content[0];
          if (content?.type !== "text") throw new Error("Expected IR verification result");
          expect(JSON.parse(content.text)).toMatchObject({
            state: "blocked", verification: "ir", reason: "trusted_project_required",
            irIssueCount: 0
          });
        }
      } finally { await client.close(); }
    }
  });

  it("rejects arbitrary flags and traversal over real MCP stdio", async () => {
    const { mkdtemp, mkdir, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const tmp = await mkdtemp(join(tmpdir(), "gungnir-ir-client-"));
    const project = join(tmp, "structured-project");
    await mkdir(join(project, "app", "models"), { recursive: true });
    await mkdir(join(project, "routes"), { recursive: true });
    await writeFile(join(project, ".gungnir-project"), "name=sample\nprofile=structured\n");
    await writeFile(join(project, "app", "models", "User.gnr"), "model User {}");
    try {
      for (const mode of ["legacy", "modern"] as const) {
        const client = await connectClient(mode, ["--project-root", project, "--trusted-root", tmp]);
        try {
          const invalid = await client.callTool({
            name: "gungnir_verify_ir", arguments: { file: "../secret.gnr" }
          });
          expect(invalid.isError).toBe(true);
          const content = invalid.content[0];
          if (content?.type !== "text") throw new Error("Expected IR result");
          expect(JSON.parse(content.text)).toMatchObject({ state: "blocked", verification: "ir" });
          expect(content.text).not.toContain(tmp);
          let rejected = false;
          try {
            const extra = await client.callTool({
              name: "gungnir_verify_ir", arguments: { file: "app/models/User.gnr", output: "evil.cpp" }
            });
            rejected = extra.isError === true;
          } catch { rejected = true; }
          expect(rejected).toBe(true);
        } finally { await client.close(); }
      }
    } finally { await rm(tmp, { recursive: true, force: true }); }
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
