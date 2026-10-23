import { spawn } from "node:child_process";
import { lstat, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, relative, sep } from "node:path";

export type NativeTool = "gungnir" | "gungnirc" | "cmake";
export type NativeOperation = "version" | "check_project" | "check_file";
export type NativeFailure = "invalid_input" | "cancelled" | "timeout" |
  "output_limit" | "spawn_failed" | "nonzero_exit";

export type NativeResult =
  | { readonly ok: true; readonly stdout: string; readonly stderr: string; readonly exitCode: 0 }
  | { readonly ok: false; readonly reason: NativeFailure; readonly exitCode: number | null;
      readonly diagnosticText?: string };

interface RequestBase {
  readonly executable: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}
export type NativeRequest =
  | (RequestBase & { readonly tool: NativeTool; readonly operation: "version" })
  | (RequestBase & { readonly tool: "gungnirc"; readonly operation: "check_project"; readonly projectRoot: string })
  | (RequestBase & { readonly tool: "gungnirc"; readonly operation: "check_file"; readonly projectRoot: string;
       readonly sourceFile: string; readonly compatibility?: boolean });

const VERSION_TIMEOUT = 3_000;
const CHECK_TIMEOUT = 10_000;
const VERSION_OUTPUT = 8_192;
const CHECK_OUTPUT = 32_768;
const MAX_CHECK_TIMEOUT = 30_000;
const MAX_OUTPUT = 65_536;

/** Do not inherit credentials, npm hooks, loader/preload injections, or app configuration. */
export function isolatedNativeEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const allowed = new Set(["path", "systemroot", "windir", "temp", "tmp", "home", "userprofile"]);
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
    if (process.platform === "win32" ? actual.toLowerCase() !== expected : actual !== expected) return null;
    const info = await stat(canonical);
    if (!info.isFile() || (process.platform !== "win32" && (info.mode & 0o111) === 0)) return null;
    return canonical;
  } catch {
    return null;
  }
}
function contained(root: string, candidate: string): boolean {
  const rest = relative(root, candidate);
  return rest === "" || (rest !== ".." && !rest.startsWith(".." + sep) && !isAbsolute(rest));
}
async function validateCheckRoot(root: string): Promise<string | null> {
  if (!isAbsolute(root) || root.includes("\0")) return null;
  try {
    const canonical = await realpath(root);
    const st = await lstat(root);
    return canonical === root && st.isDirectory() && !st.isSymbolicLink() ? root : null;
  } catch { return null; }
}
async function validateCheckFile(root: string, file: string): Promise<string | null> {
  if (!isAbsolute(file) || !file.endsWith(".gnr") || file.includes("\0") || !contained(root, file)) return null;
  try {
    const canonical = await realpath(file);
    const st = await lstat(file);
    return canonical === file && contained(root, canonical) && st.isFile() && !st.isSymbolicLink()
      ? canonical : null;
  } catch { return null; }
}
function validLimit(value: number | undefined, fallback: number, max: number): number | null {
  const v = value ?? fallback;
  return Number.isSafeInteger(v) && v > 0 && v <= max ? v : null;
}
function terminate(pid: number | undefined, kill: () => boolean): void {
  if (process.platform !== "win32" && pid !== undefined && pid > 0) {
    try { process.kill(-pid, "SIGKILL"); return; } catch { /* fall back to direct child */ }
  }
  try { kill(); } catch { /* already stopped */ }
}

/** Strict allowlist. The request does not accept arbitrary argv, cwd, shell or env. */
export async function runAllowedNative(request: NativeRequest): Promise<NativeResult> {
  const denied: NativeResult = { ok: false, reason: "invalid_input", exitCode: null };
  if (!request || !["gungnir", "gungnirc", "cmake"].includes(request.tool)) return denied;
  const check = request.operation === "check_project" || request.operation === "check_file";
  if (request.operation !== "version" && !check) return denied;
  if (check && request.tool !== "gungnirc") return denied;
  const timeout = validLimit(request.timeoutMs, check ? CHECK_TIMEOUT : VERSION_TIMEOUT,
    check ? MAX_CHECK_TIMEOUT : 10_000);
  const limit = validLimit(request.maxOutputBytes, check ? CHECK_OUTPUT : VERSION_OUTPUT, MAX_OUTPUT);
  if (timeout === null || limit === null) return denied;
  if (request.signal?.aborted) return { ok: false, reason: "cancelled", exitCode: null };
  const executable = await validateExecutable(request.executable, request.tool);
  if (!executable) return denied;
  let args: string[] = ["--version"];
  if (request.operation === "check_project") {
    const root = await validateCheckRoot(request.projectRoot);
    if (!root) return denied;
    args = ["--project", root, "--check"];
  } else if (request.operation === "check_file") {
    const root = await validateCheckRoot(request.projectRoot);
    if (!root) return denied;
    const source = await validateCheckFile(root, request.sourceFile);
    if (!source) return denied;
    args = [source, "--check"];
    if (request.compatibility === true) args.push("--compat");
    else if (request.compatibility !== undefined && request.compatibility !== false) return denied;
  }
  if (request.signal?.aborted) return { ok: false, reason: "cancelled", exitCode: null };
  return await new Promise<NativeResult>(done => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, args, {
        shell: false, windowsHide: true, detached: process.platform !== "win32",
        cwd: tmpdir(), env: isolatedNativeEnvironment(),
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
      if (bytes > limit) failAndStop("output_limit");
      else target.push(buffer);
    };
    const timer = setTimeout(() => failAndStop("timeout"), timeout);
    child.stdout?.on("data", (chunk: Buffer) => record(chunk, stdout));
    child.stderr?.on("data", (chunk: Buffer) => record(chunk, stderr));
    child.once("error", () => failAndStop("spawn_failed"));
    child.once("close", (code: number | null) => {
      completed = true;
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
      if (failure) done({ ok: false, reason: failure, exitCode: code });
      else if (code !== 0) {
        // Only compiler-check operations can pass bounded stderr to the internal parser.
        if (check) done({ ok: false, reason: "nonzero_exit", exitCode: code,
          diagnosticText: Buffer.concat(stderr).toString("utf8") });
        else done({ ok: false, reason: "nonzero_exit", exitCode: code });
      } else done({ ok: true, stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"), exitCode: 0 });
    });
    request.signal?.addEventListener("abort", onAbort, { once: true });
    if (request.signal?.aborted) onAbort();
  });
}
