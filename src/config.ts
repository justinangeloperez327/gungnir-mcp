import { realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, relative, resolve, sep, win32 } from "node:path";
import * as z from "zod/v4";

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export interface RuntimeConfig {
  readonly projectRoot: string | null;
  readonly trustedRoots: readonly string[];
}

const schema = z.object({
  projectRoot: z.string().min(1).nullable(),
  trustedRoots: z.array(z.string().min(1)).max(16)
}).strict();

export function disabledRuntimeConfig(): RuntimeConfig {
  return { projectRoot: null, trustedRoots: [] };
}

export function isContained(root: string, candidate: string): boolean {
  const part = relative(root, candidate);
  return part === "" || (part !== ".." && !part.startsWith(".." + sep) && !isAbsolute(part));
}

function selectInputs(args: readonly string[], env: NodeJS.ProcessEnv): {
  projectRoot: string | null;
  trustedRoots: string[];
} {
  let cliProject: string | undefined;
  const cliTrust: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag !== "--project-root" && flag !== "--trusted-root") {
      throw new ConfigurationError("Unknown configuration argument");
    }
    const value = args[++i];
    if (!value || value.startsWith("--")) {
      throw new ConfigurationError("Missing configuration argument value");
    }
    if (flag === "--project-root") {
      if (cliProject !== undefined) {
        throw new ConfigurationError("Project root may only be specified once");
      }
      cliProject = value;
    } else {
      cliTrust.push(value);
    }
  }

  const projectRoot = cliProject ?? env.GUNGNIR_MCP_PROJECT_ROOT ?? null;
  const trustedRoots = cliTrust.length > 0
    ? cliTrust
    : env.GUNGNIR_MCP_TRUSTED_ROOTS === undefined
      ? []
      : env.GUNGNIR_MCP_TRUSTED_ROOTS.split(delimiter);
  const parsed = schema.safeParse({ projectRoot, trustedRoots });
  if (!parsed.success) throw new ConfigurationError("Invalid project configuration");
  return parsed.data;
}

async function canonicalDirectory(path: string): Promise<string> {
  if (path.includes("\0") || !isAbsolute(path)) {
    throw new ConfigurationError("Configured roots must be absolute directory paths");
  }
  try {
    const canonical = await realpath(path);
    if (!(await stat(canonical)).isDirectory()) {
      throw new ConfigurationError("Configured path is not a directory");
    }
    return canonical;
  } catch {
    throw new ConfigurationError("Configured directory is unavailable or not a directory");
  }
}

/**
 * Load only operator-supplied startup options. Tool arguments cannot modify
 * project trust. Existing paths are canonicalized to defeat symlink bypass.
 */
export async function loadRuntimeConfig(
  args: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<RuntimeConfig> {
  const input = selectInputs(args, env);
  if (input.projectRoot === null) {
    if (input.trustedRoots.length !== 0) {
      throw new ConfigurationError("A project root is required when trusted roots are provided");
    }
    return disabledRuntimeConfig();
  }
  if (input.trustedRoots.length === 0) {
    throw new ConfigurationError("Project root requires at least one explicit trusted root");
  }

  const projectRoot = await canonicalDirectory(input.projectRoot);
  const trustedRoots = await Promise.all(input.trustedRoots.map(canonicalDirectory));
  if (!trustedRoots.some(root => isContained(root, projectRoot))) {
    throw new ConfigurationError("Project root is outside the configured trusted roots");
  }
  return Object.freeze({
    projectRoot,
    trustedRoots: Object.freeze([...new Set(trustedRoots)])
  });
}

/**
 * Resolve an EXISTING local path beneath the trusted project root.
 * Never use this function for non-existing write targets or as the only
 * defense against races when opening files or launching native code.
 */
export async function resolveExistingProjectPath(
  config: RuntimeConfig,
  relativePath: string
): Promise<string> {
  if (!config.projectRoot) throw new ConfigurationError("Project access is disabled");
  if (relativePath.trim() === "" || relativePath.includes("\0")
    || isAbsolute(relativePath) || win32.isAbsolute(relativePath)
    || relativePath.includes(":")
    || relativePath.split(/[\\/]/u).includes("..")) {
    throw new ConfigurationError("Invalid relative project path");
  }
  const candidate = resolve(config.projectRoot, relativePath);
  if (!isContained(config.projectRoot, candidate)) {
    throw new ConfigurationError("Project path escapes its configured root");
  }
  let canonical: string;
  try {
    canonical = await realpath(candidate);
  } catch {
    throw new ConfigurationError("Project path is unavailable");
  }
  if (!isContained(config.projectRoot, canonical)) {
    throw new ConfigurationError("Project path escapes its configured root");
  }
  return canonical;
}
