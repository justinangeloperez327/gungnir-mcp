import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { isContained } from "./config.js";
import type { RuntimeConfig } from "./config.js";

export type ProjectProfile = "structured" | "legacy" | "invalid";
export type ProjectCategory = "models" | "controllers" | "middleware" | "migrations" |
  "requests" | "events" | "listeners" | "policies" | "notifications" |
  "mail" | "jobs" | "routes" | "other";

export interface GungnirModule {
  readonly path: string;
  readonly module: string;
  readonly category: ProjectCategory;
}
export interface ProjectScan {
  readonly profile: ProjectProfile;
  readonly marker: "present" | "missing" | "invalid";
  readonly name: string | null;
  readonly modules: readonly GungnirModule[];
  readonly truncated: boolean;
  readonly scannedEntries: number;
  readonly diagnostics: readonly string[];
  readonly structure: Readonly<Record<string, boolean>>;
}
export interface ProjectInfo {
  readonly profile: ProjectProfile;
  readonly marker: ProjectScan["marker"];
  readonly name: string | null;
  readonly moduleCount: number;
  readonly categories: Readonly<Partial<Record<ProjectCategory, number>>>;
  readonly structure: ProjectScan["structure"];
  readonly truncated: boolean;
  readonly scannedEntries: number;
  readonly diagnostics: readonly string[];
}
export interface ProjectModuleList {
  readonly modules: readonly GungnirModule[];
  readonly count: number;
  readonly truncated: boolean;
  readonly diagnostics: readonly string[];
}
export class ProjectInspectionError extends Error {
  constructor() {
    super("Project inspection unavailable or trust invalid");
    this.name = "ProjectInspectionError";
  }
}

const MAX_ENTRIES = 2_048;
const MAX_MODULES = 200;
const MAX_DEPTH = 12;
const MARKER_MAX_BYTES = 4_096;
const SENSITIVE = /(?:^|[_-])(?:secret|secrets|credential|credentials|password|passwords|token|tokens|private-key|api-key|id-rsa|id-ed25519)(?:$|[_-])/iu;
const EXCLUDED = new Set([
  ".git", ".gungnir", "build", "vendor", "storage", "node_modules", "dist", "coverage",
  ".cache", ".vscode", ".idea", "target", "tmp", "temp", "logs", "__pycache__",
  "out", ".next", "artifacts", "generated", "bin", "obj"
]);

function visibleName(value: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9_-]{0,95}$/u.test(value)
    && !value.startsWith(".") && !SENSITIVE.test(value);
}
function skipName(value: string): boolean {
  return value.startsWith(".") || EXCLUDED.has(value.toLowerCase()) || !visibleName(value);
}
function normalizeRelative(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join("/");
}
function category(path: string): ProjectCategory {
  const parts = path.split("/");
  if (parts[0] === "routes") return "routes";
  if (parts[0] === "database" && parts[1] === "migrations") return "migrations";
  if (parts[0] === "app") {
    const kind = parts[1];
    const named: readonly ProjectCategory[] = [
      "models", "controllers", "middleware", "requests", "events", "listeners",
      "policies", "notifications", "mail", "jobs"
    ];
    if (kind && named.includes(kind as ProjectCategory)) return kind as ProjectCategory;
  }
  return "other";
}

/** A trust check performed again at inspection time, not just at startup. */
async function trustedRoot(config: RuntimeConfig): Promise<string> {
  if (!config.projectRoot || !config.trustedRoots.length) throw new ProjectInspectionError();
  try {
    const actual = await realpath(config.projectRoot);
    const st = await lstat(config.projectRoot);
    if (!st.isDirectory() || actual !== config.projectRoot ||
        !config.trustedRoots.some(root => isContained(root, actual))) {
      throw new ProjectInspectionError();
    }
    return actual;
  } catch {
    throw new ProjectInspectionError();
  }
}

async function isSafeEntry(root: string, absolute: string, directory: boolean): Promise<boolean> {
  try {
    if (!isContained(root, absolute)) return false;
    const st = await lstat(absolute);
    if (st.isSymbolicLink() || (directory ? !st.isDirectory() : !st.isFile())) return false;
    const canonical = await realpath(absolute);
    return isContained(root, canonical) && canonical === absolute;
  } catch {
    return false;
  }
}

type Marker = Pick<ProjectScan, "profile" | "marker" | "name">;
async function readProjectMarker(root: string): Promise<Marker> {
  const file = join(root, ".gungnir-project");
  try {
    // The marker itself is the sole file whose contents are inspected.
    const st = await lstat(file);
    if (!st.isFile() || st.isSymbolicLink() || st.size > MARKER_MAX_BYTES) {
      return { profile: "invalid", marker: "invalid", name: null };
    }
    if (!(await isSafeEntry(root, file, false))) {
      return { profile: "invalid", marker: "invalid", name: null };
    }
    const flags = constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW);
    const fh = await open(file, flags);
    let raw: string;
    try {
      const current = await fh.stat();
      if (!current.isFile() || current.size > MARKER_MAX_BYTES) {
        return { profile: "invalid", marker: "invalid", name: null };
      }
      // Bounded read even if a file grows between the size check and the read.
      const buffer = Buffer.alloc(MARKER_MAX_BYTES + 1);
      const { bytesRead } = await fh.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MARKER_MAX_BYTES) {
        return { profile: "invalid", marker: "invalid", name: null };
      }
      raw = buffer.toString("utf8", 0, bytesRead);
    } finally {
      await fh.close();
    }
    const values = new Map<string, string>();
    for (const line of raw.split(/\r?\n/u)) {
      if (!line.trim()) continue;
      const match = /^(name|profile)=([^\r\n]*)$/u.exec(line);
      if (!match?.[1] || match[2] === undefined || values.has(match[1])) {
        return { profile: "invalid", marker: "invalid", name: null };
      }
      values.set(match[1], match[2]);
    }
    const declared = values.get("profile");
    if (declared !== undefined && declared !== "structured") {
      return { profile: "invalid", marker: "invalid", name: null };
    }
    const suppliedName = values.get("name");
    // Marker strings are untrusted metadata: limit and sanitize before returning.
    const name = suppliedName && visibleName(suppliedName) ? suppliedName : null;
    return { profile: declared === "structured" ? "structured" : "legacy", marker: "present", name };
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") {
      return { profile: "legacy", marker: "missing", name: null };
    }
    return { profile: "invalid", marker: "invalid", name: null };
  }
}

/**
 * Bounded, read-only metadata inspection. Never reads .gnr contents or follows
 * symlinks. It returns only restricted relative path names, not absolute paths.
 * Group 6 deliberately does not perform grammar or semantic validation.
 */
export async function scanProject(config: RuntimeConfig): Promise<ProjectScan> {
  const root = await trustedRoot(config);
  const marker = await readProjectMarker(root);
  const modules: GungnirModule[] = [];
  const found = new Set<string>();
  const diagnostics = new Set<string>();
  let scannedEntries = 0;
  let truncated = false;
  let symlinksSkipped = false;

  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  while (queue.length > 0 && !truncated) {
    const current = queue.shift();
    if (!current) break;
    if (!(await isSafeEntry(root, current.path, true))) {
      diagnostics.add("unsafe_directory_ignored");
      continue;
    }
    try {
      const dir = await opendir(current.path);
      const entries: Array<{ name: string; directory: boolean; file: boolean; symlink: boolean }> = [];
      try {
        for await (const entry of dir) {
          if (scannedEntries >= MAX_ENTRIES) { truncated = true; break; }
          scannedEntries++;
          entries.push({
            name: entry.name, directory: entry.isDirectory(),
            file: entry.isFile(), symlink: entry.isSymbolicLink()
          });
        }
      } finally {
        // for-await closes the handle; explicit close is not required.
      }
      entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      for (const entry of entries) {
        if (entry.symlink) { symlinksSkipped = true; continue; }
        if (entry.directory ? skipName(entry.name)
          : entry.file && entry.name.endsWith(".gnr")
            ? !visibleName(entry.name.slice(0, -4))
            : skipName(entry.name)) continue;
        const child = join(current.path, entry.name);
        if (entry.directory) {
          if (current.depth >= MAX_DEPTH) {
            truncated = true;
            diagnostics.add("max_depth_reached");
            continue;
          }
          if (await isSafeEntry(root, child, true)) {
            queue.push({ path: child, depth: current.depth + 1 });
            const rel = normalizeRelative(root, child);
            if (rel === "app" || rel === "routes" || rel === "database" || rel === "bootstrap") {
              found.add(rel);
            }
          } else {
            diagnostics.add("unsafe_directory_ignored");
          }
          continue;
        }
        if (!entry.file || !entry.name.endsWith(".gnr")) continue;
        if (modules.length >= MAX_MODULES) {
          truncated = true;
          diagnostics.add("module_limit_reached");
          break;
        }
        const stem = entry.name.slice(0, -4);
        if (!visibleName(stem) || !(await isSafeEntry(root, child, false))) {
          diagnostics.add("unsafe_file_ignored");
          continue;
        }
        const rel = normalizeRelative(root, child);
        const moduleName = rel.slice(0, -4).replaceAll("/", ".");
        modules.push({ path: rel, module: moduleName, category: category(rel) });
      }
    } catch {
      diagnostics.add("unreadable_directory_ignored");
    }
  }

  if (marker.marker === "invalid") diagnostics.add("invalid_project_marker");
  if (marker.marker === "missing") diagnostics.add("project_marker_missing");
  if (symlinksSkipped) diagnostics.add("symlinks_ignored");
  if (marker.profile === "structured" && !found.has("app")) diagnostics.add("structured_app_directory_missing");
  if (marker.profile === "structured" && !found.has("routes")) diagnostics.add("structured_routes_directory_missing");
  if (marker.profile === "structured" && modules.length === 0) diagnostics.add("no_gnr_modules_found");
  if (truncated) diagnostics.add("scan_truncated");

  modules.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return {
    ...marker, modules, truncated, scannedEntries,
    diagnostics: [...diagnostics].sort(),
    structure: {
      app: found.has("app"),
      routes: found.has("routes"),
      database: found.has("database"),
      bootstrap: found.has("bootstrap")
    }
  };
}

export function summarizeProject(scan: ProjectScan): ProjectInfo {
  const categories: Partial<Record<ProjectCategory, number>> = {};
  for (const entry of scan.modules) {
    categories[entry.category] = (categories[entry.category] ?? 0) + 1;
  }
  return {
    profile: scan.profile, marker: scan.marker, name: scan.name,
    moduleCount: scan.modules.length, categories, structure: scan.structure,
    truncated: scan.truncated, scannedEntries: scan.scannedEntries,
    diagnostics: scan.diagnostics
  };
}

export function listProjectModules(scan: ProjectScan): ProjectModuleList {
  return {
    modules: scan.modules, count: scan.modules.length,
    truncated: scan.truncated, diagnostics: scan.diagnostics
  };
}
