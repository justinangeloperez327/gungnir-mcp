import { execFile } from "node:child_process";
import { stat, realpath, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const PROBE_TIMEOUT_MS = 3_000;
const OUTPUT_LIMIT = 8_192;
const SDK_MANIFEST_LIMIT = 16_384;

export type ToolState = "ready" | "missing" | "invalid" | "incompatible";
export type SdkProfile = "core" | "application" | "custom" | "unknown";
export type DiscoverySource = "sdk-root" | "cmake-prefix" | "path";
export interface BinaryInfo {
  readonly state: ToolState;
  readonly version: string | null;
}
export interface SdkInfo {
  readonly state: ToolState;
  readonly version: string | null;
  readonly profile: SdkProfile;
  readonly adapters: Readonly<Record<string, boolean>>;
}
export interface ToolchainReport {
  readonly state: ToolState;
  readonly source: DiscoverySource;
  readonly cli: BinaryInfo;
  readonly compiler: BinaryInfo;
  readonly cmake: BinaryInfo;
  readonly sdk: SdkInfo;
  readonly diagnostics: readonly string[];
}

type BinaryKind = "gungnir" | "gungnirc" | "cmake";
export type VersionProbe = (absolutePath: string, kind: BinaryKind) => Promise<string>;
export interface DiscoveryOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly probe?: VersionProbe;
}

const MISSING: BinaryInfo = { state: "missing", version: null };
const ADAPTERS = [
  "sqlite", "password", "postgresql", "mysql", "sqlserver", "mongodb",
  "redis", "smtp", "otlp", "tls", "http2", "s3"
] as const;

/** Only canonical executable files, never .cmd/.bat shell wrappers. */
async function executable(path: string, platform: NodeJS.Platform): Promise<string | null> {
  try {
    if (path.includes("\0") || !isAbsolute(path)) return null;
    if (platform === "win32" && !path.toLowerCase().endsWith(".exe")) return null;
    const canonical = await realpath(path);
    const details = await stat(canonical);
    if (!details.isFile()) return null;
    if (platform !== "win32" && (details.mode & 0o111) === 0) return null;
    return canonical;
  } catch {
    return null;
  }
}

async function findOnPath(
  kind: BinaryKind, env: NodeJS.ProcessEnv, platform: NodeJS.Platform
): Promise<string | null> {
  const name = kind + (platform === "win32" ? ".exe" : "");
  for (const dir of (env.PATH ?? env.Path ?? "").split(delimiter)) {
    // Empty/relative PATH entries would implicitly authorize process.cwd().
    if (!dir || !isAbsolute(dir) || dir.includes("\0")) continue;
    const candidate = await executable(join(dir, name), platform);
    if (candidate) return candidate;
  }
  return null;
}

function parseVersion(output: string, kind: BinaryKind): string | null {
  const escaped = kind === "cmake" ? "cmake" : kind;
  const match = new RegExp("\\b" + escaped + "\\b[^\\r\\n\\d]{0,32}(?:version\\s*)?v?(\\d+\\.\\d+(?:\\.\\d+)?)", "i").exec(output);
  return match?.[1] ?? null;
}

function major(version: string): number {
  return Number(version.split(".")[0]);
}
function cmakeCompatible(version: string): boolean {
  const [majorVersion = 0, minorVersion = 0] = version.split(".").map(Number);
  return majorVersion > 3 || (majorVersion === 3 && minorVersion >= 25);
}

export const defaultVersionProbe: VersionProbe = async (path, kind) => {
  // This is *only* a fixed --version query; never accepts AI-selected commands.
  // Do not inherit user secrets or application configuration into a subprocess.
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "LD_LIBRARY_PATH"]) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  const result = await exec(path, ["--version"], {
    timeout: PROBE_TIMEOUT_MS,
    maxBuffer: OUTPUT_LIMIT,
    windowsHide: true,
    shell: false,
    cwd: tmpdir(),
    env: environment
  });
  const text = result.stdout + "\n" + result.stderr;
  if (!parseVersion(text, kind)) throw new Error("unexpected version banner");
  return text;
};

async function probeBinary(
  path: string | null, kind: BinaryKind, probe: VersionProbe, diagnostics: string[]
): Promise<BinaryInfo> {
  if (!path) {
    diagnostics.push(kind + ": not found");
    return MISSING;
  }
  try {
    const output = await probe(path, kind);
    const version = parseVersion(output.slice(0, OUTPUT_LIMIT), kind);
    if (!version) {
      diagnostics.push(kind + ": version banner could not be verified");
      return { state: "invalid", version: null };
    }
    const compatible = kind === "cmake" ? cmakeCompatible(version) : major(version) === 1;
    if (!compatible) diagnostics.push(kind + ": unsupported version " + version);
    return { state: compatible ? "ready" : "incompatible", version };
  } catch {
    // Error messages from an executable can contain host secrets or paths.
    diagnostics.push(kind + ": version probe failed or timed out");
    return { state: "invalid", version: null };
  }
}

function parseManifest(content: string): Record<string, string> | null {
  const fields: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const line of content.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const match = /^([a-z][a-z0-9_]*)=([^\r\n]*)$/u.exec(line);
    if (!match?.[1] || match[2] === undefined || Object.hasOwn(fields, match[1])) return null;
    fields[match[1]] = match[2];
  }
  return fields;
}

async function readSdk(root: string | null, diagnostics: string[]): Promise<SdkInfo> {
  const empty: SdkInfo = { state: "missing", version: null, profile: "unknown", adapters: {} };
  if (!root) { diagnostics.push("sdk: no SDK selected"); return empty; }
  try {
    const manifest = join(root, "share", "gungnir", "sdk.txt");
    const s = await stat(manifest);
    if (!s.isFile() || s.size > SDK_MANIFEST_LIMIT) throw new Error("invalid marker");
    const content = await readFile(manifest, "utf8");
    const fields = parseManifest(content);
    if (!fields) throw new Error("invalid marker");
    const version = fields.package_version ?? null;
    const profileValue = fields.profile?.toLowerCase();
    const profile: SdkProfile = profileValue === "core" || profileValue === "application"
      ? profileValue : profileValue ? "custom" : "unknown";
    if (!version || !/^\d+\.\d+\.\d+$/u.test(version)) throw new Error("invalid version");
    const adapters: Record<string, boolean> = {};
    for (const key of ADAPTERS) {
      if (fields[key] === "ON" || fields[key] === "OFF") adapters[key] = fields[key] === "ON";
    }
    const compatible = major(version) === 1;
    if (!compatible) diagnostics.push("sdk: unsupported package version " + version);
    if (profile === "unknown") diagnostics.push("sdk: profile not specified");
    return { state: compatible && profile !== "unknown" ? "ready" : "incompatible", version, profile, adapters };
  } catch {
    diagnostics.push("sdk: missing or invalid share/gungnir/sdk.txt");
    return { ...empty, state: "invalid" };
  }
}

function overall(items: readonly ToolState[]): ToolState {
  if (items.includes("incompatible")) return "incompatible";
  if (items.includes("invalid")) return "invalid";
  if (items.includes("missing")) return "missing";
  return "ready";
}

/**
 * Read-only toolchain discovery. It probes three hard-coded executables with
 * --version only; no project code is loaded and no build is ever initiated.
 * The returned report deliberately excludes all absolute host paths.
 */
export async function discoverToolchain(options: DiscoveryOptions = {}): Promise<ToolchainReport> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const probe = options.probe ?? defaultVersionProbe;
  const diagnostics: string[] = [];

  const explicit = env.GUNGNIR_MCP_SDK_ROOT;
  const prefix = explicit === undefined ? env.GUNGNIR_CMAKE_PREFIX : undefined;
  const source: DiscoverySource = explicit !== undefined ? "sdk-root"
    : prefix !== undefined ? "cmake-prefix" : "path";
  let root: string | null = null;
  let cliPath: string | null = null;
  let compilerPath: string | null = null;

  if (source !== "path") {
    const requested = explicit ?? prefix ?? "";
    if (!isAbsolute(requested) || requested.includes("\0")) {
      diagnostics.push("sdk: override must be an absolute directory");
    } else {
      try {
        const canonical = await realpath(requested);
        if ((await stat(canonical)).isDirectory()) {
          root = canonical;
          cliPath = await executable(join(root, "bin", "gungnir" + (platform === "win32" ? ".exe" : "")), platform);
          compilerPath = await executable(join(root, "bin", "gungnirc" + (platform === "win32" ? ".exe" : "")), platform);
        } else {
          diagnostics.push("sdk: override is not a directory");
        }
      } catch { diagnostics.push("sdk: override directory not found"); }
    }
  } else {
    cliPath = await findOnPath("gungnir", env, platform);
    compilerPath = await findOnPath("gungnirc", env, platform);
    if (cliPath && compilerPath && dirname(cliPath) === dirname(compilerPath)) {
      root = dirname(dirname(cliPath));
    } else if (cliPath && compilerPath) {
      diagnostics.push("sdk: CLI and compiler are from different installations");
    }
  }

  const cmakePath = await findOnPath("cmake", env, platform);
  const [cli, compiler, cmake, sdk] = await Promise.all([
    probeBinary(cliPath, "gungnir", probe, diagnostics),
    probeBinary(compilerPath, "gungnirc", probe, diagnostics),
    probeBinary(cmakePath, "cmake", probe, diagnostics),
    readSdk(root, diagnostics)
  ]);

  if (cli.version && compiler.version && cli.version !== compiler.version) {
    diagnostics.push("compiler: version differs from Gungnir CLI");
  }
  if (sdk.version && (cli.version && sdk.version !== cli.version ||
    compiler.version && sdk.version !== compiler.version)) {
    diagnostics.push("sdk: package version differs from tool versions");
  }
  const states = [cli.state, compiler.state, cmake.state, sdk.state];
  if (diagnostics.some(d => d.includes("differs from") || d.includes("different installations"))) {
    states.push("incompatible");
  }
  return {
    state: overall(states),
    source,
    cli, compiler, cmake, sdk,
    diagnostics: [...diagnostics].sort()
  };
}
