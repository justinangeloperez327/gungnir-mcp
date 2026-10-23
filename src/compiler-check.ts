import { resolve } from "node:path";

import type { RuntimeConfig } from "./config.js";
import { runAllowedNative } from "./process-runner.js";
import type { NativeRequest, NativeResult } from "./process-runner.js";
import { scanProject } from "./project.js";
import type { ProjectScan } from "./project.js";
import { locateCompiler } from "./toolchain.js";

export type CheckState = "valid" | "invalid" | "blocked" |
  "unavailable" | "timeout" | "cancelled" | "output_limit" | "failed";
export interface CheckDiagnostic {
  readonly file: string | null;
  readonly line: number;
  readonly column: number;
  readonly severity: "error" | "warning";
  readonly code: string | null;
  readonly message: string;
}
export interface CheckReport {
  readonly state: CheckState;
  readonly target: "project" | "file";
  readonly file: string | null;
  readonly exitCode: number | null;
  readonly diagnostics: readonly CheckDiagnostic[];
  readonly diagnosticsTruncated: boolean;
  readonly reason: string | null;
}

type CheckDeps = {
  readonly locate?: () => Promise<string | null>;
  readonly execute?: (request: NativeRequest) => Promise<NativeResult>;
  readonly inspect?: (config: RuntimeConfig) => Promise<ProjectScan>;
};
const MAX_DIAGNOSTICS = 40;
const HEADER = /^(.*):([1-9]\d{0,6}):([1-9]\d{0,6}): (error|warning)(?:\[(GNR\d{4})\])?: (.+)$/u;

function safeMessage(raw: string, root: string): string {
  const noControls = raw.replace(/[\x00-\x1f\x7f]/gu, " ").trim();
  // Errors can echo private paths or literal source tokens. Redact strings,
  // absolute paths, and the configured project root before returning to MCP.
  return noControls.replaceAll(root, "[project]")
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/gu, "[value]")
    .replace(/[A-Za-z]:[\\/][^\s,;]+/gu, "[path]")
    .replace(/\/(?:home|Users|tmp|private|var|mnt|etc)\/[^\s,;]+/gu, "[path]")
    .slice(0, 200) || "Compiler diagnostic";
}

export function normalizeCompilerDiagnostics(
  stderr: string, root: string, scan: ProjectScan
): { diagnostics: CheckDiagnostic[]; truncated: boolean } {
  const files = new Map<string, string>();
  for (const module of scan.modules) {
    files.set(resolve(root, module.path).replaceAll("\\", "/"), module.path);
    files.set(module.path, module.path);
  }
  const found: CheckDiagnostic[] = [];
  let truncated = false;
  for (const line of stderr.split(/\r?\n/u)) {
    const match = HEADER.exec(line.trim());
    if (!match) continue; // never forward compiler source excerpts or help lines
    if (found.length >= MAX_DIAGNOSTICS) { truncated = true; break; }
    const [ , rawFile, rawLine, rawColumn, severity, code, rawMessage ] = match;
    if (!rawFile || !rawLine || !rawColumn || !rawMessage) continue;
    const normalizedPath = rawFile.replaceAll("\\", "/");
    found.push({
      file: files.get(normalizedPath) ?? null,
      line: Number(rawLine),
      column: Number(rawColumn),
      severity: severity === "warning" ? "warning" : "error",
      code: code ?? null,
      message: safeMessage(rawMessage, root)
    });
  }
  return { diagnostics: found, truncated };
}

function errorReport(
  target: "project" | "file", file: string | null,
  state: CheckState, reason: string, exitCode: number | null = null
): CheckReport {
  return { target, file, state, reason, exitCode, diagnostics: [], diagnosticsTruncated: false };
}

const UNSAFE_SCAN = new Set([
  "symlinks_ignored", "scan_truncated", "unreadable_directory_ignored",
  "unsafe_directory_ignored", "unsafe_file_ignored", "invalid_project_marker"
]);

/**
 * One optional project-relative .gnr path. A missing path checks the entire
 * structured project. No arbitrary user argv, cwd or absolute path is accepted.
 */
export async function checkGungnir(
  config: RuntimeConfig,
  file?: string,
  deps: CheckDeps = {}
): Promise<CheckReport> {
  const target = file === undefined ? "project" : "file";
  const requestedFile = file ?? null;
  if (file !== undefined && (
    file.length === 0 || file.length > 256 ||
    file.startsWith("/") || file.includes("\\") || file.includes(":") ||
    file.includes("\0") || file.split("/").some(x => x === ".." || x === "." || x === "")
    || !file.endsWith(".gnr")
  )) return errorReport(target, null, "blocked", "invalid_file_path");
  if (!config.projectRoot || !config.trustedRoots.length) {
    return errorReport(target, null, "blocked", "trusted_project_required");
  }

  let scan: ProjectScan;
  try {
    scan = await (deps.inspect ?? scanProject)(config);
  } catch {
    return errorReport(target, null, "blocked", "project_inspection_failed");
  }
  if (scan.truncated || scan.diagnostics.some(d => UNSAFE_SCAN.has(d))) {
    return errorReport(target, requestedFile, "blocked", "unsafe_or_incomplete_scan");
  }
  if (target === "project" && scan.profile !== "structured") {
    return errorReport(target, null, "blocked", "structured_project_required");
  }
  const module = file === undefined ? undefined : scan.modules.find(m => m.path === file);
  if (file !== undefined && !module) {
    return errorReport(target, null, "blocked", "file_not_in_trusted_module_index");
  }
  let compiler: string | null;
  try { compiler = await (deps.locate ?? locateCompiler)(); }
  catch { compiler = null; }
  if (!compiler) return errorReport(target, requestedFile, "unavailable", "compiler_not_found");

  const base = {
    executable: compiler,
    tool: "gungnirc" as const,
    projectRoot: config.projectRoot
  };
  const request: NativeRequest = file === undefined
    ? { ...base, operation: "check_project" }
    : { ...base, operation: "check_file",
        sourceFile: resolve(config.projectRoot, file),
        compatibility: scan.profile === "legacy" };
  let result: NativeResult;
  try { result = await (deps.execute ?? runAllowedNative)(request); }
  catch { return errorReport(target, requestedFile, "failed", "compiler_process_failed"); }

  if (result.ok) {
    const parsed = normalizeCompilerDiagnostics(result.stderr, config.projectRoot, scan);
    return {
      target, file: requestedFile, state: "valid", reason: null, exitCode: 0,
      diagnostics: parsed.diagnostics, diagnosticsTruncated: parsed.truncated
    };
  }
  if (result.reason === "nonzero_exit") {
    const parsed = normalizeCompilerDiagnostics(result.diagnosticText ?? "", config.projectRoot, scan);
    return {
      target, file: requestedFile, state: "invalid", reason: "compiler_rejected_source",
      exitCode: result.exitCode, diagnostics: parsed.diagnostics,
      diagnosticsTruncated: parsed.truncated
    };
  }
  const states: Partial<Record<string, CheckState>> = {
    timeout: "timeout", cancelled: "cancelled", output_limit: "output_limit",
    invalid_input: "blocked", spawn_failed: "failed"
  };
  return errorReport(target, requestedFile, states[result.reason] ?? "failed",
    "compiler_" + result.reason, result.exitCode);
}
