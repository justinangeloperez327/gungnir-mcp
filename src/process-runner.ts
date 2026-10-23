import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute } from "node:path";

export type NativeTool = "gungnir" | "gungnirc" | "cmake";
export type NativeOperation = "version";
export type NativeFailure = "invalid_input" | "cancelled" | "timeout" |
  "output_limit" | "spawn_failed" | "nonzero_exit";

export type NativeResult =
  | { readonly ok: true; readonly stdout: string; readonly stderr: string; readonly exitCode: 0 }
  | { readonly ok: false; readonly reason: NativeFailure; readonly exitCode: number | null };

export interface NativeRequest {
  readonly executable: string;
  readonly tool: NativeTool;
  readonly operation: NativeOperation;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

const ALLOWED: Readonly<Record<NativeTool, Readonly<Record<NativeOperation, readonly string[]>>>> = {
  gungnir: { version: ["--version"] },
  gungnirc: { version: ["--version"] },
  cmake: { version: ["--version"] }
};

const DEFAULT_TIMEOUT = 3_000;
const DEFAULT_OUTPUT_LIMIT = 8_192;
const MAX_TIMEOUT = 10_000;
const MAX_OUTPUT_LIMIT = 65_536;

/**
 * Explicit, small environment allowlist. No inherited credentials, npm scripts,
 * shell controls, preload hooks, or dynamic library injection variables.
 */
export function isolatedNativeEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const allowed = new Set([
    "path", "systemroot", "windir", "temp", "tmp", "home", "userprofile"
  ]);
  for (const [name, value] of Object.entries(source)) {
    if (allowed.has(name.toLowerCase()) && value !== undefined && !value.includes("\0")) {
      env[name] = value;
    }
  }
  return env;
}

async function validateExecutable(path: string, tool: NativeTool): Promise<string | null> {
  if (!path || path.includes("\0") || !isAbsolute(path)) return null;
  try {
    const canonical = await realpath(path);
    const expected = tool + (process.platform === "win32" ? ".exe" : "");
    const actual = basename(canonical);
    if (process.platform === "win32" ? actual.toLowerCase() !== expected : actual !== expected) {
      return null;
    }
    const info = await stat(canonical);
    if (!info.isFile() || (process.platform !== "win32" && (info.mode & 0o111) === 0)) return null;
    return canonical;
  } catch {
    return null;
  }
}

function validLimit(n: number | undefined, fallback: number, max: number): number | null {
  const value = n ?? fallback;
  return Number.isSafeInteger(value) && value > 0 && value <= max ? value : null;
}

/** Terminate the direct child; on POSIX also terminate its process group. */
function terminate(pid: number | undefined, kill: () => boolean): void {
  if (process.platform !== "win32" && pid !== undefined && pid > 0) {
    try { process.kill(-pid, "SIGKILL"); return; } catch { /* fall back to direct child */ }
  }
  try { kill(); } catch { /* process already stopped */ }
}

/**
 * Group 5 supports only fixed --version probes. No caller-controlled argv,
 * cwd, shell or environment. All errors are structured and redact raw output.
 * Internal caller-supplied signals, timeouts and output limits are bounded.
 */
export async function runAllowedNative(request: NativeRequest): Promise<NativeResult> {
  if (!request || !Object.hasOwn(ALLOWED, request.tool) || request.operation !== "version") {
    return { ok: false, reason: "invalid_input", exitCode: null };
  }
  const timeout = validLimit(request.timeoutMs, DEFAULT_TIMEOUT, MAX_TIMEOUT);
  const limit = validLimit(request.maxOutputBytes, DEFAULT_OUTPUT_LIMIT, MAX_OUTPUT_LIMIT);
  if (timeout === null || limit === null) return { ok: false, reason: "invalid_input", exitCode: null };
  if (request.signal?.aborted) return { ok: false, reason: "cancelled", exitCode: null };
  const executable = await validateExecutable(request.executable, request.tool);
  if (!executable) return { ok: false, reason: "invalid_input", exitCode: null };
  if (request.signal?.aborted) return { ok: false, reason: "cancelled", exitCode: null };

  return await new Promise<NativeResult>((done) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, [...ALLOWED[request.tool].version], {
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        cwd: tmpdir(),
        env: isolatedNativeEnvironment(),
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch {
      done({ ok: false, reason: "spawn_failed", exitCode: null });
      return;
    }

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let failure: NativeFailure | undefined;
    let completed = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const failAndStop = (reason: NativeFailure): void => {
      if (completed || failure) return;
      failure = reason;
      terminate(child.pid, () => child.kill("SIGKILL"));
    };
    const onAbort = (): void => { failAndStop("cancelled"); };
    const record = (chunk: Buffer | string, target: Buffer[]): void => {
      if (failure || completed) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > limit) {
        failAndStop("output_limit");
      } else {
        target.push(buffer);
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => record(chunk, stdout));
    child.stderr?.on("data", (chunk: Buffer) => record(chunk, stderr));
    child.once("error", () => { failAndStop("spawn_failed"); });
    child.once("close", (code: number | null) => {
      completed = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      request.signal?.removeEventListener("abort", onAbort);
      if (failure) {
        done({ ok: false, reason: failure, exitCode: code });
      } else if (code !== 0) {
        done({ ok: false, reason: "nonzero_exit", exitCode: code });
      } else {
        done({
          ok: true, stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"), exitCode: 0
        });
      }
    });

    // Attach after close handling so early failures are still reaped.
    request.signal?.addEventListener("abort", onAbort, { once: true });
    if (request.signal?.aborted) onAbort();
    timeoutHandle = setTimeout(() => { failAndStop("timeout"); }, timeout);
  });
}
