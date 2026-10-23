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
  readonly verification?: "ir";
  readonly irIssueCount?: number;
  readonly irIssuesTruncated?: boolean;
}

export type CheckDeps = {
  readonly locate?: () => Promise<string | null>;
  readonly execute?: (request: NativeRequest) => Promise<NativeResult>;
  readonly inspect?: (config: RuntimeConfig) => Promise<ProjectScan>;
};
const MAX_DIAGNOSTICS = 40;
const HEADER = /^(.*):([1-9]\d{0,6}):([1-9]\d{0,6}): (error|warning)(?:\[(GNR\d{4})\])?: (.+)$/u;

/**
 * Never echo native diagnostic text verbatim: even an unquoted identifier can
 * contain credentials or user source. Preserve actionable issue categories,
 * GNR codes, severity and location without disclosing source fragments.
 */
function safeMessage(raw: string): string {
  const text = raw.toLowerCase();
  if (/\b(unresolved|undefined|unknown|undeclared|not found)\b/u.test(text)) return "Unresolved symbol or reference";
  if (/\b(type mismatch|incompatible type|cannot convert)\b/u.test(text)) return "Type mismatch";
  if (/\b(duplicate|already defined|redeclaration)\b/u.test(text)) return "Duplicate declaration";
  if (/\b(syntax|unexpected|expected|parse|token)\b/u.test(text)) return "Syntax validation error";
  if (/\b(missing|required)\b/u.test(text)) return "Required declaration or value missing";
  if (/\b(ambiguous|conflict|cycle|circular)\b/u.test(text)) return "Ambiguous or cyclic dependency";
  if (/\b(invalid|unsupported|illegal)\b/u.test(text)) return "Invalid or unsupported construct";
  return "Compiler diagnostic (details withheld)";
}

/** The verifier's " - ..." lines may contain private IR/source data. Count only. */
export function summarizeIrFailures(stderr: string): { count: number; truncated: boolean; verifierFailure: boolean } {
  const verifierFailure = stderr.includes("gungnirc: error: invalid C++ IR");
  if (!verifierFailure) return { count: 0, truncated: false, verifierFailure: false };
  let count = 0;
  for (const line of stderr.split(/\r?\n/u)) {
    if (/^\s+-\s+\S/u.test(line)) count++;
  }
  return { count: Math.min(count, MAX_DIAGNOSTICS), truncated: count > MAX_DIAGNOSTICS, verifierFailure: true };
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
      message: safeMessage(rawMessage)
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
 * Compiler check and IR verify share the same trusted project/index guard.
 * Only the selected fixed native operation can be sent to the runner.
 */
type ValidationMode = "check" | "ir";

export async function checkGungnir(
  config: RuntimeConfig, file?: string, deps: CheckDeps = {}
): Promise<CheckReport> {
  return await validateGungnir(config, file, "check", deps);
}

export async function verifyGungnirIr(
  config: RuntimeConfig, file?: string, deps: CheckDeps = {}
): Promise<CheckReport> {
  return await validateGungnir(config, file, "ir", deps);
}

async function validateGungnir(
  config: RuntimeConfig, file: string | undefined,
  mode: ValidationMode, deps: CheckDeps
): Promise<CheckReport> {
  const decorate = (report: CheckReport, stderr = ""): CheckReport => {
    if (mode === "check") return report;
    const issues = summarizeIrFailures(stderr);
    return { ...report, verification: "ir", irIssueCount: issues.count,
      irIssuesTruncated: issues.truncated };
  };
  const error = (
    target: "project" | "file", file: string | null,
    state: CheckState, reason: string, exitCode: number | null = null
  ): CheckReport => decorate(errorReport(target, file, state, reason, exitCode));

  const target = file === undefined ? "project" : "file";
  const requestedFile = file ?? null;
  if (file !== undefined && (
    file.length === 0 || file.length > 256 ||
    file.startsWith("/") || file.includes("\\") || file.includes(":") ||
    file.includes("\0") || file.split("/").some(x => x === ".." || x === "." || x === "")
    || !file.endsWith(".gnr")
  )) return error(target, null, "blocked", "invalid_file_path");
  if (!config.projectRoot || !config.trustedRoots.length) {
    return error(target, null, "blocked", "trusted_project_required");
  }

  let scan: ProjectScan;
  try {
    scan = await (deps.inspect ?? scanProject)(config);
  } catch {
    return error(target, null, "blocked", "project_inspection_failed");
  }
  if (scan.truncated || scan.diagnostics.some(d => UNSAFE_SCAN.has(d))) {
    return error(target, requestedFile, "blocked", "unsafe_or_incomplete_scan");
  }
  if ((target === "project" || mode === "ir") && scan.profile !== "structured") {
    return error(target, null, "blocked", "structured_project_required");
  }
  const module = file === undefined ? undefined : scan.modules.find(m => m.path === file);
  if (file !== undefined && !module) {
    return error(target, null, "blocked", "file_not_in_trusted_module_index");
  }
  let compiler: string | null;
  try { compiler = await (deps.locate ?? locateCompiler)(); }
  catch { compiler = null; }
  if (!compiler) return error(target, requestedFile, "unavailable", "compiler_not_found");

  const base = {
    executable: compiler,
    tool: "gungnirc" as const,
    projectRoot: config.projectRoot
  };
  const request: NativeRequest = file === undefined
    ? { ...base, operation: mode === "ir" ? "verify_ir_project" : "check_project" }
    : mode === "ir"
      ? { ...base, operation: "verify_ir_file", sourceFile: resolve(config.projectRoot, file) }
      : { ...base, operation: "check_file", sourceFile: resolve(config.projectRoot, file),
          compatibility: scan.profile === "legacy" };
  let result: NativeResult;
  try { result = await (deps.execute ?? runAllowedNative)(request); }
  catch { return error(target, requestedFile, "failed", "compiler_process_failed"); }

  if (result.ok) {
    const parsed = normalizeCompilerDiagnostics(result.stderr, config.projectRoot, scan);
    const rejected = parsed.diagnostics.some(d => d.severity === "error");
    return decorate({
      target, file: requestedFile, state: rejected ? "invalid" : "valid",
      reason: rejected ? "compiler_reported_errors" : null, exitCode: 0,
      diagnostics: parsed.diagnostics, diagnosticsTruncated: parsed.truncated
    }, result.stderr);
  }
  if (result.reason === "nonzero_exit") {
    const parsed = normalizeCompilerDiagnostics(result.diagnosticText ?? "", config.projectRoot, scan);
    const summary = mode === "ir"
      ? summarizeIrFailures(result.diagnosticText ?? "") : null;
    return decorate({
      target, file: requestedFile, state: "invalid",
      reason: summary?.verifierFailure ? "ir_verification_failed" : "compiler_rejected_source",
      exitCode: result.exitCode, diagnostics: parsed.diagnostics,
      diagnosticsTruncated: parsed.truncated
    }, result.diagnosticText ?? "");
  }
  const states: Partial<Record<string, CheckState>> = {
    timeout: "timeout", cancelled: "cancelled", output_limit: "output_limit",
    invalid_input: "blocked", spawn_failed: "failed"
  };
  return error(target, requestedFile, states[result.reason] ?? "failed",
    "compiler_" + result.reason, result.exitCode);
}
