import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkGungnir, normalizeCompilerDiagnostics } from "../src/compiler-check.js";
import { loadRuntimeConfig } from "../src/config.js";
import type { RuntimeConfig } from "../src/config.js";
import type { NativeResult } from "../src/process-runner.js";
import { scanProject } from "../src/project.js";

let root: string;
let workspace: string;
let project: string;
let config: RuntimeConfig;
let file: string;
let compiler: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "gungnir-check-"));
  workspace = join(root, "workspace");
  project = join(workspace, "inventory");
  await mkdir(join(project, "app", "models"), { recursive: true });
  await mkdir(join(project, "routes"), { recursive: true });
  await writeFile(join(project, ".gungnir-project"), "name=inventory\nprofile=structured\n");
  file = join(project, "app", "models", "User.gnr");
  await writeFile(file, "model User {}\n");
  await writeFile(join(project, "routes", "web.gnr"), "Route::get\n");
  config = await loadRuntimeConfig(["--project-root", project, "--trusted-root", workspace], {});
  // Windows temp paths may be returned as 8.3 aliases; native operations use the canonical root.
  project = config.projectRoot ?? project;
  file = join(project, "app", "models", "User.gnr");
  compiler = join(root, "sdk", "bin", process.platform === "win32" ? "gungnirc.exe" : "gungnirc");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function fake(result: NativeResult) {
  const execute = vi.fn(async (): Promise<NativeResult> => result);
  return {
    execute,
    locate: vi.fn(async () => compiler)
  };
}

describe("trusted compiler validation", () => {
  it("checks a structured project using only the fixed native operation", async () => {
    const deps = fake({ ok: true, exitCode: 0, stdout: "", stderr: "" });
    const report = await checkGungnir(config, undefined, deps);
    expect(report).toMatchObject({ state: "valid", target: "project", file: null, exitCode: 0 });
    expect(deps.execute).toHaveBeenCalledWith({
      executable: compiler,
      tool: "gungnirc",
      operation: "check_project",
      projectRoot: project
    });
  });

  it("checks only indexed source files and uses structured mode", async () => {
    const deps = fake({ ok: true, exitCode: 0, stdout: "", stderr: "" });
    const report = await checkGungnir(config, "app/models/User.gnr", deps);
    expect(report).toMatchObject({ state: "valid", target: "file", file: "app/models/User.gnr" });
    expect(deps.execute).toHaveBeenCalledWith({
      executable: compiler,
      tool: "gungnirc",
      operation: "check_file",
      projectRoot: project,
      sourceFile: file,
      compatibility: false
    });
  });

  it("uses --compat semantics for legacy single-file checks, and refuses legacy project checks", async () => {
    await writeFile(join(project, ".gungnir-project"), "name=inventory\n");
    const deps = fake({ ok: true, exitCode: 0, stdout: "", stderr: "" });
    const whole = await checkGungnir(config, undefined, deps);
    expect(whole).toMatchObject({ state: "blocked", reason: "structured_project_required" });
    await checkGungnir(config, "app/models/User.gnr", deps);
    expect(deps.execute).toHaveBeenCalledWith(expect.objectContaining({
      operation: "check_file", compatibility: true
    }));
  });

  it("denies all user paths outside the bounded module index", async () => {
    const deps = fake({ ok: true, exitCode: 0, stdout: "", stderr: "" });
    for (const path of [
      "../secret.gnr", "app/../other.gnr", "app\\models\\User.gnr",
      "C:\\Windows\\test.gnr", "/tmp/test.gnr", "app/models/User.gnr --format",
      "app/models/User.gnr\0", "app/models/secret.gnr", "missing.gnr",
      ".env", "", "./app/models/User.gnr", "app//models/User.gnr"
    ]) {
      const report = await checkGungnir(config, path, deps);
      expect(report.state).toBe("blocked");
    }
    expect(deps.locate).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it("requires trusted roots even for a valid file name", async () => {
    const deps = fake({ ok: true, exitCode: 0, stdout: "", stderr: "" });
    expect((await checkGungnir({ projectRoot: null, trustedRoots: [] }, undefined, deps)).state).toBe("blocked");
    expect((await checkGungnir({ projectRoot: null, trustedRoots: [] }, "app/models/User.gnr", deps)).state).toBe("blocked");
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it("fails closed for symlinks and incomplete or malformed project scans", async () => {
    const deps = fake({ ok: true, exitCode: 0, stdout: "", stderr: "" });
    const outside = join(root, "outside");
    await mkdir(outside);
    await symlink(outside, join(project, "external"), process.platform === "win32" ? "junction" : "dir");
    expect(await checkGungnir(config, undefined, deps)).toMatchObject({
      state: "blocked", reason: "unsafe_or_incomplete_scan"
    });
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it("refuses an unknown compiler installation without running a fallback", async () => {
    const deps = { locate: vi.fn(async () => null), execute: vi.fn() };
    const result = await checkGungnir(config, undefined, deps);
    expect(result).toMatchObject({ state: "unavailable", reason: "compiler_not_found" });
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it("returns structured error diagnostics but never raw source excerpts or absolute paths", async () => {
    const stderr = [
      file + ":4:9: error[GNR1324]: unknown reference 'SuperSecret'",
      "4 | const private_token = SUPER_SECRET_SOURCE;",
      "  | ^~~~~",
      "help: try reading /home/private/token.txt",
      file + ':5:2: warning[GNR1001]: unused "top secret"',
      "/tmp/outside/secret.gnr:2:2: error[GNR9000]: unexpected"
    ].join("\n");
    const deps = fake({ ok: false, reason: "nonzero_exit", exitCode: 1, diagnosticText: stderr });
    const result = await checkGungnir(config, "app/models/User.gnr", deps);
    expect(result).toMatchObject({ state: "invalid", target: "file", reason: "compiler_rejected_source", exitCode: 1 });
    expect(result.diagnostics).toHaveLength(3);
    expect(result.diagnostics[0]).toMatchObject({
      file: "app/models/User.gnr", line: 4, column: 9, severity: "error", code: "GNR1324"
    });
    expect(result.diagnostics[2]?.file).toBeNull();
    const json = JSON.stringify(result);
    expect(json).not.toContain(root);
    expect(json).not.toContain("SUPER_SECRET_SOURCE");
    expect(json).not.toContain("SuperSecret");
    expect(json).not.toContain("top secret");
    expect(json).not.toContain("help:");
  });

  it("maps runtime timeout, cancellation and output failures to stable status codes", async () => {
    for (const reason of ["timeout", "cancelled", "output_limit", "spawn_failed", "invalid_input"] as const) {
      const deps = fake({ ok: false, reason, exitCode: null });
      const report = await checkGungnir(config, undefined, deps);
      expect(report.state).toBe(
        reason === "spawn_failed" ? "failed" : reason === "invalid_input" ? "blocked" : reason
      );
      expect(JSON.stringify(report)).not.toContain(root);
    }
  });

  it("limits the number of reported diagnostics", async () => {
    const scan = await scanProject(config);
    const stderr = Array.from({ length: 52 }, (_, i) =>
      "app/models/User.gnr:" + (i + 1) + ":1: error[GNR1001]: issue").join("\n");
    const parsed = normalizeCompilerDiagnostics(stderr, project, scan);
    expect(parsed.diagnostics).toHaveLength(40);
    expect(parsed.truncated).toBe(true);
  });

  it("never returns arbitrary thrown native process errors to MCP", async () => {
    const report = await checkGungnir(config, undefined, {
      locate: async () => compiler, execute: async () => { throw new Error("TOKEN=very-secret"); }
    });
    expect(report).toMatchObject({ state: "failed", reason: "compiler_process_failed" });
    expect(JSON.stringify(report)).not.toContain("TOKEN");
  });
});
