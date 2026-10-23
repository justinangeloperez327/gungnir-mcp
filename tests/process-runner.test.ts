import { chmod, copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isolatedNativeEnvironment, runAllowedNative } from "../src/process-runner.js";
import type { NativeRequest } from "../src/process-runner.js";

let directory: string;
let executable: string;
const windows = process.platform === "win32";

async function program(body: string): Promise<void> {
  if (windows) return;
  await writeFile(executable, "#!/bin/sh\n" + body + "\n");
  await chmod(executable, 0o755);
}

function request(extra: Partial<NativeRequest> = {}): NativeRequest {
  return { executable, tool: "gungnir", operation: "version", ...extra };
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "gungnir-mcp-runner-"));
  executable = join(directory, windows ? "gungnir.exe" : "gungnir");
  if (windows) {
    // A real native .exe without .cmd/.bat wrappers, enabling Windows process tests.
    await copyFile(process.execPath, executable);
  } else {
    await program('test "$#" = 1 && test "$1" = "--version" || exit 42\nprintf "gungnir version 1.0.2\\n"');
  }
});

afterAll(async () => {
  await rm(directory, { force: true, recursive: true });
});

describe("strict native command allowlist", () => {
  it("executes only the fixed --version argument", async () => {
    const result = await runAllowedNative(request());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.exitCode).toBe(0);
      expect(result.stdout.length).toBeGreaterThan(0);
    }
  });

  it("refuses build, shell, project and unregistered operations", async () => {
    for (const payload of [
      { ...request(), operation: "build" },
      { ...request(), operation: "run" },
      { ...request(), operation: "check" },
      { ...request(), tool: "sh" },
      { ...request(), tool: "gungnir; touch INJECTED" },
      { ...request(), tool: "__proto__" }
    ]) {
      const result = await runAllowedNative(payload as NativeRequest);
      expect(result).toEqual({ ok: false, reason: "invalid_input", exitCode: null });
    }
  });

  it("rejects relative executables, wrong executable names, and Windows shell wrappers", async () => {
    const invalidPaths = [
      "./gungnir", join(directory, "unknown"),
      join(directory, "gungnir.cmd"),
      join(directory, "gungnir.bat")
    ];
    for (const path of invalidPaths) {
      expect(await runAllowedNative(request({ executable: path }))).toEqual({
        ok: false, reason: "invalid_input", exitCode: null
      });
    }
    expect(await runAllowedNative(request({ tool: "cmake" }))).toMatchObject({
      ok: false, reason: "invalid_input"
    });
  });

  it("enforces bounded time and output limits", async () => {
    const values = [
      { timeoutMs: 0 }, { timeoutMs: -1 }, { timeoutMs: 10_001 },
      { timeoutMs: 1.5 }, { maxOutputBytes: 0 }, { maxOutputBytes: 65_537 },
      { maxOutputBytes: Number.NaN }
    ];
    for (const options of values) {
      expect(await runAllowedNative(request(options))).toMatchObject({
        ok: false, reason: "invalid_input"
      });
    }
  });

  it("rejects an already aborted signal before starting a process", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await runAllowedNative(request({ signal: controller.signal }))).toEqual({
      ok: false, reason: "cancelled", exitCode: null
    });
  });

  it("limits combined stdout and stderr and redacts rejected output", async () => {
    await program('printf "SUPER_SECRET_OUTPUT\\n"; printf "stderr-secret\\n" >&2');
    const result = await runAllowedNative(request({ maxOutputBytes: 2 }));
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: "output_limit" });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it.skipIf(windows)("reports nonzero exit without exposing raw child output", async () => {
    await program('printf "private value\\n" >&2\nexit 9');
    const result = await runAllowedNative(request());
    expect(result).toMatchObject({ ok: false, reason: "nonzero_exit", exitCode: 9 });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it.skipIf(windows)("enforces timeout against a hanging native process", async () => {
    await program('sleep 5');
    const result = await runAllowedNative(request({ timeoutMs: 30 }));
    expect(result).toMatchObject({ ok: false, reason: "timeout" });
  });

  it.skipIf(windows)("cancels an in-flight native process", async () => {
    await program('sleep 5');
    const controller = new AbortController();
    const promise = runAllowedNative(request({ signal: controller.signal }));
    setTimeout(() => controller.abort(), 30);
    const result = await promise;
    expect(result).toMatchObject({ ok: false, reason: "cancelled" });
  });

  it.skipIf(windows)("does not inherit arbitrary application environment variables", async () => {
    await program('if [ -n "$GUNGNIR_SECRET_TOKEN" ]; then printf "leaked"; else printf "isolated"; fi');
    const previous = process.env.GUNGNIR_SECRET_TOKEN;
    process.env.GUNGNIR_SECRET_TOKEN = "PRIVATE";
    try {
      const result = await runAllowedNative(request());
      expect(result).toMatchObject({ ok: true, stdout: "isolated" });
    } finally {
      if (previous === undefined) delete process.env.GUNGNIR_SECRET_TOKEN;
      else process.env.GUNGNIR_SECRET_TOKEN = previous;
    }
  });
});

describe("native environment isolation", () => {
  it("copies only known runtime variables and drops secrets and preload hooks", () => {
    const env = isolatedNativeEnvironment({
      PATH: "/usr/bin",
      TEMP: "/tmp",
      HOME: "/home/user",
      GUNGNIR_SECRET_TOKEN: "secret",
      NODE_OPTIONS: "--require ./evil.js",
      LD_PRELOAD: "/tmp/evil.so",
      LD_LIBRARY_PATH: "/tmp/untrusted",
      npm_config_registry: "https://internal.example",
      SYSTEMROOT: "C:\\Windows"
    });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.TEMP).toBe("/tmp");
    expect(env.SYSTEMROOT).toBe("C:\\Windows");
    for (const name of ["GUNGNIR_SECRET_TOKEN", "NODE_OPTIONS", "LD_PRELOAD", "LD_LIBRARY_PATH", "npm_config_registry"]) {
      expect(env).not.toHaveProperty(name);
    }
  });

  it("rejects environment entries containing NUL", () => {
    expect(isolatedNativeEnvironment({
      PATH: "before\0after", HOME: "/safe"
    })).toEqual({ HOME: "/safe" });
  });
});
